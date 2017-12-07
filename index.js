 /**
    Copyright 2017 Brahim Dagher All Rights Reserved.
    Adapted from https://github.com/KazuCocoa/alexa-tide-pooler

    Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with the License. A copy of the License is located at

        http://aws.amazon.com/apache2.0/

    or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

/**
 * This sample shows how to create a Lambda function for handling Alexa Skill requests that:
 * - Web service: communicate with an external web service to get tide data from NOAA CO-OPS API (http://tidesandcurrents.noaa.gov/api/)
 * - Multiple optional slots: has 2 slots (city and date), where the user can provide 0, 1, or 2 values, and assumes defaults for the unprovided values
 * - DATE slot: demonstrates date handling and formatted date responses appropriate for speech
 * - Custom slot type: demonstrates using custom slot types to handle a finite set of known values
 * - Dialog and Session state: Handles two models, both a one-shot ask and tell model, and a multi-turn dialog model.
 *   If the user provides an incorrect slot in a one-shot model, it will direct to the dialog model. See the
 *   examples section for sample interactions of these models.
 * - Pre-recorded audio: Uses the SSML 'audio' tag to include an ocean wave sound in the welcome response.
 *
 * Examples:
 * One-shot model:
 *  User:  "Alexa, ask Cape Cod Tides when is the high tide in Barnstable on Saturday"
 *  Alexa: "Saturday June 20th in Barnstable the first high tide will be around 7:18 am,
 *          and will peak at ...""
 * Dialog model:
 *  User:  "Alexa, open Tide Pooler"
 *  Alexa: "Welcome to Tide Pooler. Which city would you like tide information for?"
 *  User:  "Plymouth"
 *  Alexa: "For which date?"
 *  User:  "this Saturday"
 *  Alexa: "Saturday June 20th in Plymouth the first high tide will be around 7:18 am,
 *          and will peak at ...""
 */

/**
 * App ID for the skill
 */
var APP_ID = 'amzn1.ask.skill.6db0a350-c075-43fd-a92d-b71d0a211fa5'; //replace with 'amzn1.echo-sdk-ams.app.[your-unique-value-here]';


var https = require('https'),
    alexaDateUtil = require('./alexaDateUtil');

/**
 * The AlexaSkill prototype and helper functions
 */
var AlexaSkill = require('./AlexaSkill');

/**
 * CapeCodTides is a child of AlexaSkill.
 * To read more about inheritance in JavaScript, see the link below.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Introduction_to_Object-Oriented_JavaScript#Inheritance
 */
var CapeCodTides = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
CapeCodTides.prototype = Object.create(AlexaSkill.prototype);
CapeCodTides.prototype.constructor = CapeCodTides;

// ----------------------- Override AlexaSkill request and intent handlers -----------------------

CapeCodTides.prototype.eventHandlers.onSessionStarted = function (sessionStartedRequest, session) {
    console.log("onSessionStarted requestId: " + sessionStartedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any initialization logic goes here
};

CapeCodTides.prototype.eventHandlers.onLaunch = function (launchRequest, session, response) {
    console.log("onLaunch requestId: " + launchRequest.requestId + ", sessionId: " + session.sessionId);
    handleWelcomeRequest(response);
};

CapeCodTides.prototype.eventHandlers.onSessionEnded = function (sessionEndedRequest, session) {
    console.log("onSessionEnded requestId: " + sessionEndedRequest.requestId
        + ", sessionId: " + session.sessionId);
    // any cleanup logic goes here
};

/**
 * override intentHandlers to map intent handling functions.
 */
CapeCodTides.prototype.intentHandlers = {
    "OneshotTideIntent": function (intent, session, response) {
        handleOneshotTideRequest(intent, session, response);
        console.log("OneshotTideIntent LAUNCHED - Sent to Handler.");
    },

    "DialogTideIntent": function (intent, session, response) {
        // Determine if this turn is for city, for date, or an error.
        // We could be passed slots with values, no slots, slots with no value.
        var citySlot = intent.slots.City;
        var dateSlot = intent.slots.Date;
        if (citySlot && citySlot.value) {
            handleCityDialogRequest(intent, session, response);
        } else if (dateSlot && dateSlot.value) {
            handleDateDialogRequest(intent, session, response);
        } else {
            handleNoSlotDialogRequest(intent, session, response);
        }
    },

    "SupportedCitiesIntent": function (intent, session, response) {
        handleSupportedCitiesRequest(intent, session, response);
    },

    "AMAZON.HelpIntent": function (intent, session, response) {
        handleHelpRequest(response);
    },

    "AMAZON.StopIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    },

    "AMAZON.CancelIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    }
};

// -------------------------- CapeCodTides Domain Specific Business Logic --------------------------

// example city to NOAA station mapping. Can be found on: http://tidesandcurrents.noaa.gov/map/
var STATIONS = {
    'plymouth':8446493,
    'barnstable':8447335,
    'sesuit harbor':8447241,
    'wellfleet':8446613,
    'provincetown':8446121,
    'chatham stage harbor':8447505,
    'harwichport wychmere harbor':8447506,
    'south yarmouth bass river':8447504,
    'dennisport':8447525,
    'hyannisport':8447605,
    'falmouth':8447865,
    'woods hole':8447939,
    'marion':8447385,
    'new bedford':8447584,
    'westport':8447975, 
    'duxbury':8446166,
    'hingham':8444775
};

function handleWelcomeRequest(response) {
    var whichCityPrompt = "Which town?",
        speechOutput = {
              speech: "<speak>"
                + "Aye Aye Captain Crunchers!"
                // + <audio src='https://s3.amazonaws.com/ask-storage/TidePooler/OceanWaves.mp3'/>"
                // + <audio src='https://s3.amazonaws.com/alexa-capecodtides/capecodsounds.mp3'/>
                + whichCityPrompt
                + "</speak>",
              type: AlexaSkill.speechOutputType.SSML
        },
        repromptOutput = {
            speech: "I can lead you through providing a town and "
                + "day of the week to get tide information, "
                + "or you can simply open Cape Cod Tides and ask a question like, "
                + "get tide information for Barnstable on Saturday. "
                + "For a list of supported towns, ask which towns are supported. "
                + whichCityPrompt,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };

    response.ask(speechOutput, repromptOutput);
}

function handleHelpRequest(response) {
    var repromptText = "Which town?";
    var speechOutput = "I can lead you through providing a town and "
        + "day of the week to get tide information, "
        + "or you can simply open Cape Cod Tides and ask a question like, "
        + "get tide information for Barnstable on Saturday. "
        + "For a list of supported towns, ask which towns are supported. "
        + "Or you can say exit. "
        + repromptText;

    response.ask(speechOutput, repromptText);
}

/**
 * Handles the case where the user asked or for, or is otherwise being with supported cities
 */
function handleSupportedCitiesRequest(intent, session, response) {
    // get city re-prompt
    var repromptText = "Which town?";
    var speechOutput = "Currently, I know tide information for these towns: " + getAllStationsText()
        + repromptText;

    response.ask(speechOutput, repromptText);
}

/**
 * Handles the dialog step where the user provides a city
 */
function handleCityDialogRequest(intent, session, response) {

    var cityStation = getCityStationFromIntent(intent, false),
        repromptText,
        speechOutput;
    if (cityStation.error) {
        repromptText = "Currently, I know tide information for these coastal towns: " + getAllStationsText()
            + "Which town would you like tide information for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;
        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a date yet, go to date. If we have a date, we perform the final request
    if (session.attributes.date) {
        getFinalTideResponse(cityStation, session.attributes.date, response);
    } else {
        // set city in session and prompt for date
        session.attributes.city = cityStation;
        speechOutput = "For which date?";
        repromptText = "For which date would you like tide information for " + cityStation.city + "?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handles the dialog step where the user provides a date
 */
function handleDateDialogRequest(intent, session, response) {

    var date = getDateFromIntent(intent),
        repromptText,
        speechOutput;
    if (!date) {
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like tide information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // if we don't have a city yet, go to city. If we have a city, we perform the final request
    if (session.attributes.city) {
        getFinalTideResponse(session.attributes.city, date, response);
    } else {
        // The user provided a date out of turn. Set date in session and prompt for city
        session.attributes.date = date;
        speechOutput = "For which town would you like tide information for " + date.displayDate + "?";
        repromptText = "For which town?";

        response.ask(speechOutput, repromptText);
    }
}

/**
 * Handle no slots, or slot(s) with no values.
 * In the case of a dialog based skill with multiple slots,
 * when passed a slot with no value, we cannot have confidence
 * it is the correct slot type so we rely on session state to
 * determine the next turn in the dialog, and reprompt.
 */
function handleNoSlotDialogRequest(intent, session, response) {
    if (session.attributes.city) {
        // get date re-prompt
        var repromptText = "Please try again saying a day of the week, for example, Saturday. ";
        var speechOutput = repromptText;

        response.ask(speechOutput, repromptText);
    } else {
        // get city re-prompt
        handleSupportedCitiesRequest(intent, session, response);
    }
}

/**
 * This handles the one-shot interaction, where the user utters a phrase like:
 * 'Alexa, open Tide Pooler and get tide information for Seattle on Saturday'.
 * If there is an error in a slot, this will guide the user to the dialog approach.
 */
function handleOneshotTideRequest(intent, session, response) {

    // Determine city, using default if none provided
    var cityStation = getCityStationFromIntent(intent, true),
        repromptText,
        speechOutput;
    if (cityStation.error) {
        // invalid city. move to the dialog
        repromptText = "Currently, I know tide information for these coastal towns: " + getAllStationsText()
            + "Which town would you like tide information for?";
        // if we received a value for the incorrect city, repeat it to the user, otherwise we received an empty slot
        speechOutput = cityStation.city ? "I'm sorry, I don't have any data for " + cityStation.city + ". " + repromptText : repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // Determine custom date
    var date = getDateFromIntent(intent);
    if (!date) {
        // Invalid date. set city in session and prompt for date
        session.attributes.city = cityStation;
        repromptText = "Please try again saying a day of the week, for example, Saturday. "
            + "For which date would you like tide information?";
        speechOutput = "I'm sorry, I didn't understand that date. " + repromptText;

        response.ask(speechOutput, repromptText);
        return;
    }

    // all slots filled, either from the user or by default values. Move to final request
    getFinalTideResponse(cityStation, date, response);
}

/**
 * Both the one-shot and dialog based paths lead to this method to issue the request, and
 * respond to the user with the final answer.
 */
function getFinalTideResponse(cityStation, date, response) {

    // Issue the request, and respond to the user
    makeTideRequest(cityStation.station, date, function tideResponseCallback(err, highTideResponse) {
        var speechOutput;

        if (err) {
            speechOutput = "Sorry, the National Oceanic tide service is experiencing a problem. Please try again later";
        } else {
            speechOutput = date.displayDate + " in " + cityStation.city + ", the first high tide will be around "
                + highTideResponse.firstHighTideTime  //", and will peak at about " + highTideResponse.firstHighTideHeight
                + ", followed by a low tide at around " + highTideResponse.lowTideTime
                //+ " that will be about " + highTideResponse.lowTideHeight
                + ". The second high tide will be around " + highTideResponse.secondHighTideTime;
                //+ ", and will peak at about " + highTideResponse.secondHighTideHeight + ".";
        }

        response.tellWithCard(speechOutput, "CapeCodTides", speechOutput)
    });
}

/**
 * Uses NOAA.gov API, documented: http://tidesandcurrents.noaa.gov/api/
 * Results can be verified at: http://tidesandcurrents.noaa.gov/noaatidepredictions/NOAATidesFacade.jsp?Stationid=[id]
 */

function makeTideRequest(station, date, tideResponseCallback) {
    //Orig Code
    var datum = "MLLW";
    var endpoint = 'https://tidesandcurrents.noaa.gov/api/datagetter';
    var queryString = '?' + date.requestDateParam;
    queryString += '&station=' + station;
    queryString += '&product=predictions&datum=' + datum + '&application=Alexa.CapeCod.Tides&units=english&time_zone=lst_ldt&format=json';

    //Orig queryString FAILED result Hingham:   https://tidesandcurrents.noaa.gov/api/datagetter?begin_date=20170923&range=24&station=8444775&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&format=json
    //Orig queryString SUCCESS result Plymouth: https://tidesandcurrents.noaa.gov/api/datagetter?begin_date=20170923&range=24&station=8446493&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&format=json
    //Below modified by BD

    //var endpoint = 'https://tidesandcurrents.noaa.gov/api/datagetter';
    //var queryString = '?' + date.requestDateParam;
    // queryString += '&station=' + station;
    // queryString += '&product=predictions';
    // queryString += '&application=Alexa.CapeCod.Tides';
    // queryString += '&datum=MLLW'
    // queryString += '&time_zone=lst_ldt';
    // queryString += '&units=english';
    // queryString += '&interval=hilo';
    // queryString += '&format=json';


    // FinalQuery looks like: https://tidesandcurrents.noaa.gov/api/datagetter?begin_date=20170924&range=24&station=8444775&product=predictions&application=Alexa.CapeCod.Tides&datum=MLLW&units=english&time_zone=lst_ldt&format=json
    // Optimal queryString looks like: https://tidesandcurrents.noaa.gov/api/datagetter?product=predictions&application=NOS.COOPS.TAC.WL&begin_date=20170919&end_date=20170920&datum=MLLW&station=8444775&time_zone=lst_ldt&units=english&interval=hilo&format=json

    https.get(endpoint + queryString, function (res) {
        var noaaResponseString = '';
        console.log('FinalQuery: ' + endpoint + queryString);
        console.log('Status Code: ' + res.statusCode);

        if (res.statusCode != 200) {
            tideResponseCallback(new Error("Non 200 Response"));
        }

        res.on('data', function (data) {
            noaaResponseString += data;
        });

        res.on('end', function () {
            var noaaResponseObject = JSON.parse(noaaResponseString);

            if (noaaResponseObject.error) {
                console.log("NOAA error: " + noaaResponseObj.error.message);
                console.log('FinalQuery: ' + endpoint + queryString);
                tideResponseCallback(new Error(noaaResponseObj.error.message));
            } else {
                var highTide = findHighTide(noaaResponseObject);
                tideResponseCallback(null, highTide);
            }
        });
    }).on('error', function (e) {
        console.log("Communications error: " + e.message);
        tideResponseCallback(new Error(e.message));
    });
}

/**
 * Algorithm to find the 2 high tides for the day, the first of which is smaller and occurs
 * mid-day, the second of which is larger and typically in the evening
 */
function findHighTide(noaaResponseObj) {
    var predictions = noaaResponseObj.predictions;
    var lastPrediction;
    var firstHighTide, secondHighTide, lowTide;
    var firstTideDone = false;

    for (var i = 0; i < predictions.length; i++) {
        var prediction = predictions[i];

        if (!lastPrediction) {
            lastPrediction = prediction;
            continue;
        }

        if (isTideIncreasing(lastPrediction, prediction)) {
            if (!firstTideDone) {
                firstHighTide = prediction;
            } else {
                secondHighTide = prediction;
            }

        } else { // we're decreasing

            if (!firstTideDone && firstHighTide) {
                firstTideDone = true;
            } else if (secondHighTide) {
                break; // we're decreasing after have found 2nd tide. We're done.
            }

            if (firstTideDone) {
                lowTide = prediction;
            }
        }

        lastPrediction = prediction;
    }

    return {
        firstHighTideTime: alexaDateUtil.getFormattedTime(new Date(firstHighTide.t)),
        firstHighTideHeight: getFormattedHeight(firstHighTide.v),
        lowTideTime: alexaDateUtil.getFormattedTime(new Date(lowTide.t)),
        lowTideHeight: getFormattedHeight(lowTide.v),
        secondHighTideTime: alexaDateUtil.getFormattedTime(new Date(secondHighTide.t)),
        secondHighTideHeight: getFormattedHeight(secondHighTide.v)
    }
}

function isTideIncreasing(lastPrediction, currentPrediction) {
    return parseFloat(lastPrediction.v) < parseFloat(currentPrediction.v);
}

/**
 * Formats the height, rounding to the nearest 1/2 foot. e.g.
 * 4.354 -> "four and a half feet".
 */
function getFormattedHeight(height) {
    var isNegative = false;
    if (height < 0) {
        height = Math.abs(height);
        isNegative = true;
    }

    var remainder = height % 1;
    var feet, remainderText;

    if (remainder < 0.25) {
        remainderText = '';
        feet = Math.floor(height);
    } else if (remainder < 0.75) {
        remainderText = " and a half";
        feet = Math.floor(height);
    } else {
        remainderText = '';
        feet = Math.ceil(height);
    }

    if (isNegative) {
        feet *= -1;
    }

    var formattedHeight = feet + remainderText + " feet";
    return formattedHeight;
}

/**
 * Gets the city from the intent, or returns an error
 */
function getCityStationFromIntent(intent, assignDefault) {

    var citySlot = intent.slots.City;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!citySlot || !citySlot.value) {
        if (!assignDefault) {
            return {
                error: true
            }
        } else {
            // For sample skill, default to Seattle.
            return {
                city: 'Plymouth',
                station: STATIONS.plymouth
            }
        }
    } else {
        // lookup the city. Sample skill uses well known mapping of a few known cities to station id.
        var cityName = citySlot.value;
        if (STATIONS[cityName.toLowerCase()]) {
            return {
                city: cityName,
                station: STATIONS[cityName.toLowerCase()]
            }
        } else {
            return {
                error: true,
                city: cityName
            }
        }
    }
}

/**
 * Gets the date from the intent, defaulting to today if none provided,
 * or returns an error
 */
function getDateFromIntent(intent) {

    var dateSlot = intent.slots.Date;
    // slots can be missing, or slots can be provided but with empty value.
    // must test for both.
    if (!dateSlot || !dateSlot.value) {
        // default to today
        return {
            displayDate: "Today",
            requestDateParam: "date=today"
        }
    } else {

        var date = new Date(dateSlot.value);

        // format the request date like YYYYMMDD
        var month = (date.getMonth() + 1);
        month = month < 10 ? '0' + month : month;
        var dayOfMonth = date.getDate();
        dayOfMonth = dayOfMonth < 10 ? '0' + dayOfMonth : dayOfMonth;
        var requestDay = "begin_date=" + date.getFullYear() + month + dayOfMonth
            + "&range=24";

        return {
            displayDate: alexaDateUtil.getFormattedDate(date),
            requestDateParam: requestDay
        }
    }
}

function getAllStationsText() {
    var stationList = '';
    for (var station in STATIONS) {
        stationList += station + ", ";
    }

    return stationList;
}

// Create the handler that responds to the Alexa Request.
exports.handler = function (event, context) {
    var capeCodTides = new CapeCodTides();
    capeCodTides.execute(event, context);
};
