const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onRequest} = require("firebase-functions/v2/https");
const {defineString} = require("firebase-functions/params");

// The Firebase Admin SDK to access Firestore.
const {initializeApp} = require("firebase-admin/app");
const {getFirestore} = require("firebase-admin/firestore");

initializeApp();

const axios = require("axios");
const jsonata = require("jsonata");

const HOME_PAGE = defineString("HOME_PAGE");
const REALPAGE_API = defineString("REALPAGE_API");
const FLOORPLAN_API = `${REALPAGE_API}/floorplans`;
const UNIT_API = `${REALPAGE_API}/units?available=false&honordisplayorder=true&siteid=8448226&bestprice=true&leaseterm=1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18`;
const API_KEY_REGEX = /apiKey:\s*'(?<API_KEY>[^']*)'/;
const RENT_FILTER = `
  $.{
    "id": $number(name),
    "rent": rent,
    "available": leaseStatus != "LEASED",
    "rentModified": $toMillis(rentModifiedTimestamp, '[Y]-[M]-[D] [H]:[m] [Z0000]')
  }
`;
const UNIT_FILTER = `
  $.{
    "id": $number(name),
    "floor": floorNumber,
    "sqrt": squareFeet,
    "floorplanId": $number(floorplanId)
  }
`;
const FLOORPLAN_FILTER = `
  $.{
    "id": $number(id),
    "name": name,
    "beds": bedRooms,
    "baths": bathRooms,
    "floorplanImg": "https://capi.myleasestar.com/v2/dimg/" & floorPlanImages[0].mediaId & "/" & floorPlanImages[0].maxWidth & "x" & floorPlanImages[0].maxHeight & "/" & floorPlanImages[0].mediaId & ".jpg"
  }
`;

/**
 * Get the API key from the floorplan page
 * @return {Promise<string>}
 */
async function getAPIKey() {
  const response = await axios.get(HOME_PAGE);
  const match = response.data.match(API_KEY_REGEX);
  if (!match) {
    throw new Error("Could not find API key");
  }
  const apiKey = match.groups.API_KEY;
  return apiKey;
}

/**
 * Get all floorplan data from the API
 * @param {*} apiKey - API key to use
 * @return {Promise<JSONObject>}
 */
async function getFloorplanData(apiKey) {
  const response = await axios.get(FLOORPLAN_API, {
    headers: {
      "x-ws-authkey": apiKey,
    },
  });
  const floorplans = response.data.response.floorplans;
  return floorplans;
}

/**
 * Get all unit data from the API
 * @param {*} apiKey - API key to use
 * @return {Promise<JSONObject>}
 */
async function getUnitData(apiKey) {
  const response = await axios.get(UNIT_API, {
    headers: {
      "x-ws-authkey": apiKey,
    },
  });
  const floorplans = response.data.response.units;
  return floorplans;
}

/**
 * Write the data to the database
 * @param {JSONObject} data - Data to write
 * @param {string} filter - JSONata filter to apply
 * @param {string} collectionName - Name of the collection to write to
 * @param {function} docNameFn - Function to generate the document name
 */
async function writeData(data, filter, collectionName, docNameFn) {
  const expression = jsonata(filter);
  const filteredData = await expression.evaluate(data);

  const collection = await getFirestore()
      .collection(collectionName);
  return Promise.all(filteredData.map((data) => {
    return collection
        .doc(docNameFn(data))
        .set(data, {merge: true});
  }));
}

/**
 * Write the rent data to the database
 * @return {Promise<void>}
 */
async function writeAllData() {
  const apiKey = await getAPIKey();

  await Promise.all([
    writeData(await getUnitData(apiKey), RENT_FILTER, "rents", (data) => `${data.id}_${data.rentModified}`),
    writeData(await getUnitData(apiKey), UNIT_FILTER, "units", (data) => `${data.id}`),
    writeData(await getFloorplanData(apiKey), FLOORPLAN_FILTER, "floorplans", (data) => `${data.id}`),
  ]);
}


exports.scrapeUnitDataSchedule = onSchedule("every day 00:00", writeAllData);
exports.scrapeUnitDataManual = onRequest(async (req, res) => {
  try {
    await writeAllData();
  } catch (error) {
    console.error(error);
    return res.status(500).send({
      status: "error",
      error: error.message,
    });
  }
  return res.send({
    status: "success",
  });
});

