/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
"use strict";

import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  setDoc,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getPerformance } from "firebase/performance";

import { getFirebaseConfig } from "./firebase-config.js";

// Signs-in Friendly Chat.
async function signIn() {
  // Sign in Firebase using popup auth and Google as the identity provider.
  var provider = new GoogleAuthProvider();
  await signInWithPopup(getAuth(), provider);
}

// Signs-out of Friendly Chat.
function signOutUser() {
  // Sign out of Firebase.
  signOut(getAuth());
}

// Initialize firebase auth
function initFirebaseAuth() {
  // Listen to auth state changes.
  onAuthStateChanged(getAuth(), authStateObserver);
}

// Returns the signed-in user's profile Pic URL.
function getProfilePicUrl() {
  return getAuth().currentUser.photoURL || "/images/profile_placeholder.png";
}

// Returns the signed-in user's display name.
function getUserName() {
  return getAuth().currentUser.displayName;
}

// Returns true if a user is signed-in.
function isUserSignedIn() {
  return !!getAuth().currentUser;
}

// Saves a new message to Cloud Firestore.
async function saveMessage(messageText) {
  // Add a new message entry to the Firebase database.
  try {
    await addDoc(collection(getFirestore(), "messages"), {
      name: getUserName(),
      text: messageText,
      profilePicUrl: getProfilePicUrl(),
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("Error writing new message to Firebase Database", error);
  }
}

// Loads chat messages history and listens for upcoming ones.
function loadMessages() {
  // Create the query to load the last 12 messages and listen for new ones.
  const recentMessagesQuery = query(
    collection(getFirestore(), "messages"),
    orderBy("timestamp", "desc"),
    limit(12)
  );

  // Start listening to the query.
  onSnapshot(recentMessagesQuery, function (snapshot) {
    snapshot.docChanges().forEach(function (change) {
      if (change.type === "removed") {
        deleteMessage(change.doc.id);
      } else {
        var message = change.doc.data();
        displayMessage(
          change.doc.id,
          message.timestamp,
          message.name,
          message.text,
          message.profilePicUrl,
          message.imageUrl
        );
      }
    });
  });
}

// Saves a new message containing an image in Firebase.
// This first saves the image in Firebase storage.
async function saveImageMessage(file) {
  try {
    // 1 - We add a message with a loading icon that will get updated with the shared image.
    const messageRef = await addDoc(collection(getFirestore(), "messages"), {
      name: getUserName(),
      imageUrl: LOADING_IMAGE_URL,
      profilePicUrl: getProfilePicUrl(),
      timestamp: serverTimestamp(),
    });

    // 2 - Upload the image to Cloud Storage.
    const filePath = `${getAuth().currentUser.uid}/${messageRef.id}/${
      file.name
    }`;
    const newImageRef = ref(getStorage(), filePath);
    const fileSnapshot = await uploadBytesResumable(newImageRef, file);

    // 3 - Generate a public URL for the file.
    const publicImageUrl = await getDownloadURL(newImageRef);

    // 4 - Update the chat message placeholder with the image's URL.
    await updateDoc(messageRef, {
      imageUrl: publicImageUrl,
      storageUri: fileSnapshot.metadata.fullPath,
    });
  } catch (error) {
    console.error(
      "There was an error uploading a file to Cloud Storage:",
      error
    );
  }
}

// Saves the messaging device token to Cloud Firestore.
async function saveMessagingDeviceToken() {
  try {
    const currentToken = await getToken(getMessaging());
    if (currentToken) {
      console.log("Got FCM device token:", currentToken);
      // Saving the Device Token to Cloud Firestore.
      const tokenRef = doc(getFirestore(), "fcmTokens", currentToken);
      await setDoc(tokenRef, { uid: getAuth().currentUser.uid });

      // This will fire when a message is received while the app is in the foreground.
      // When the app is in the background, firebase-messaging-sw.js will receive the message instead.
      onMessage(getMessaging(), (message) => {
        console.log(
          "New foreground notification from Firebase Messaging!",
          message.notification
        );
      });
    } else {
      // Need to request permissions to show notifications.
      requestNotificationsPermissions();
    }
  } catch (error) {
    console.error("Unable to get messaging token.", error);
  }
}

// Requests permissions to show notifications.
async function requestNotificationsPermissions() {
  console.log("Requesting notifications permission...");
  const permission = await Notification.requestPermission();

  if (permission === "granted") {
    console.log("Notification permission granted.");
    // Notification permission granted.
    await saveMessagingDeviceToken();
  } else {
    console.log("Unable to get permission to notify.");
  }
}

// Triggered when a file is selected via the media picker.
function onMediaFileSelected(event) {
  event.preventDefault();
  var file = event.target.files[0];

  // Clear the selection in the file picker input.
  imageFormElement.reset();

  // Check if the file is an image.
  if (!file.type.match("image.*")) {
    var data = {
      message: "You can only share images",
      timeout: 2000,
    };
    signInSnackbarElement.MaterialSnackbar.showSnackbar(data);
    return;
  }
  // Check if the user is signed-in
  if (checkSignedInWithMessage()) {
    saveImageMessage(file);
  }
}

// Triggered when the send new message form is submitted.
function onMessageFormSubmit(e) {
  e.preventDefault();
  // Check that the user entered a message and is signed in.
  if (messageInputElement.value && checkSignedInWithMessage()) {
    saveMessage(messageInputElement.value).then(function () {
      // Clear message text field and re-enable the SEND button.
      resetMaterialTextfield(messageInputElement);
      toggleButton();
    });
  }
}

// Triggers when the auth state change for instance when the user signs-in or signs-out.
function authStateObserver(user) {
  if (user) {
    // User is signed in!
    // Get the signed-in user's profile pic and name.
    var profilePicUrl = getProfilePicUrl();
    var userName = getUserName();

    // Set the user's profile pic and name.
    userPicElement.style.backgroundImage =
      "url(" + addSizeToGoogleProfilePic(profilePicUrl) + ")";
    userNameElement.textContent = userName;

    // Show user's profile and sign-out button.
    userNameElement.removeAttribute("hidden");
    userPicElement.removeAttribute("hidden");
    signOutButtonElement.removeAttribute("hidden");

    // Hide sign-in button.
    signInButtonElement.setAttribute("hidden", "true");

    // We save the Firebase Messaging Device token and enable notifications.
    saveMessagingDeviceToken();
  } else {
    // User is signed out!
    // Hide user's profile and sign-out button.
    userNameElement.setAttribute("hidden", "true");
    userPicElement.setAttribute("hidden", "true");
    signOutButtonElement.setAttribute("hidden", "true");

    // Show sign-in button.
    signInButtonElement.removeAttribute("hidden");
  }
}

// Returns true if user is signed-in. Otherwise false and displays a message.
function checkSignedInWithMessage() {
  // Return true if the user is signed in Firebase
  if (isUserSignedIn()) {
    return true;
  }

  // Display a message to the user using a Toast.
  var data = {
    message: "You must sign-in first",
    timeout: 2000,
  };
  signInSnackbarElement.MaterialSnackbar.showSnackbar(data);
  return false;
}

// Resets the given MaterialTextField.
function resetMaterialTextfield(element) {
  element.value = "";
  element.parentNode.MaterialTextfield.boundUpdateClassesHandler();
}

// Template for messages.
var MESSAGE_TEMPLATE =
  '<div class="message-container">' +
  '<div class="spacing"><div class="pic"></div></div>' +
  '<div class="message"></div>' +
  '<div class="name"></div>' +
  "</div>";

// Adds a size to Google Profile pics URLs.
function addSizeToGoogleProfilePic(url) {
  if (url.indexOf("googleusercontent.com") !== -1 && url.indexOf("?") === -1) {
    return url + "?sz=150";
  }
  return url;
}

// A loading image URL.
var LOADING_IMAGE_URL = "https://www.google.com/images/spin-32.gif?a";

// Delete a Message from the UI.
function deleteMessage(id) {
  var div = document.getElementById(id);
  // If an element for that message exists we delete it.
  if (div) {
    div.parentNode.removeChild(div);
  }
}

function createAndInsertMessage(id, timestamp) {
  const container = document.createElement("div");
  container.innerHTML = MESSAGE_TEMPLATE;
  const div = container.firstChild;
  div.setAttribute("id", id);

  // If timestamp is null, assume we've gotten a brand new message.
  // https://stackoverflow.com/a/47781432/4816918
  timestamp = timestamp ? timestamp.toMillis() : Date.now();
  div.setAttribute("timestamp", timestamp);

  // figure out where to insert new message
  const existingMessages = messageListElement.children;
  if (existingMessages.length === 0) {
    messageListElement.appendChild(div);
  } else {
    let messageListNode = existingMessages[0];

    while (messageListNode) {
      const messageListNodeTime = messageListNode.getAttribute("timestamp");

      if (!messageListNodeTime) {
        throw new Error(
          `Child ${messageListNode.id} has no 'timestamp' attribute`
        );
      }

      if (messageListNodeTime > timestamp) {
        break;
      }

      messageListNode = messageListNode.nextSibling;
    }

    messageListElement.insertBefore(div, messageListNode);
  }

  return div;
}

// Displays a Message in the UI.
function displayMessage(id, timestamp, name, text, picUrl, imageUrl) {
  var div =
    document.getElementById(id) || createAndInsertMessage(id, timestamp);

  // profile picture
  if (picUrl) {
    div.querySelector(".pic").style.backgroundImage =
      "url(" + addSizeToGoogleProfilePic(picUrl) + ")";
  }

  div.querySelector(".name").textContent = name;
  var messageElement = div.querySelector(".message");

  if (text) {
    // If the message is text.
    messageElement.textContent = text;
    // Replace all line breaks by <br>.
    messageElement.innerHTML = messageElement.innerHTML.replace(/\n/g, "<br>");
  } else if (imageUrl) {
    // If the message is an image.
    var image = document.createElement("img");
    image.addEventListener("load", function () {
      messageListElement.scrollTop = messageListElement.scrollHeight;
    });
    image.src = imageUrl + "&" + new Date().getTime();
    messageElement.innerHTML = "";
    messageElement.appendChild(image);
  }
  // Show the card fading-in and scroll to view the new message.
  setTimeout(function () {
    div.classList.add("visible");
  }, 1);
  messageListElement.scrollTop = messageListElement.scrollHeight;
  //messageInputElement.focus();
}

// Enables or disables the submit button depending on the values of the input
// fields.
function toggleButton() {
  if (messageInputElement.value) {
    submitButtonElement.removeAttribute("disabled");
  } else {
    submitButtonElement.setAttribute("disabled", "true");
  }
}

// Shortcuts to DOM Elements.
var messageListElement = document.getElementById("messages");
var messageFormElement = document.getElementById("message-form");
var messageInputElement = document.getElementById("message");
var submitButtonElement = document.getElementById("submit");
var imageButtonElement = document.getElementById("submitImage");
var imageFormElement = document.getElementById("image-form");
var mediaCaptureElement = document.getElementById("mediaCapture");
var userPicElement = document.getElementById("user-pic");
var userNameElement = document.getElementById("user-name");
var signInButtonElement = document.getElementById("sign-in");
var signOutButtonElement = document.getElementById("sign-out");
var signInSnackbarElement = document.getElementById("must-signin-snackbar");

// Saves message on form submit.
messageFormElement.addEventListener("submit", onMessageFormSubmit);
signOutButtonElement.addEventListener("click", signOutUser);
signInButtonElement.addEventListener("click", signIn);

// Toggle for the button.
messageInputElement.addEventListener("keyup", toggleButton);
messageInputElement.addEventListener("change", toggleButton);

// Events for image upload.
imageButtonElement.addEventListener("click", function (e) {
  e.preventDefault();
  mediaCaptureElement.click();
});
mediaCaptureElement.addEventListener("change", onMediaFileSelected);

const firebaseAppConfig = getFirebaseConfig();
// TODO 0: Initialize Firebase

//--------WHERE'S WALLY?---------------------------------------------------------

// Save the points of interest in Firestore
async function savePointsOfInterest(pointsOfInterest) {
  try {
    const collectionRef = collection(getFirestore(), "pointsOfInterest");
    await Promise.all(
      pointsOfInterest.map(async (point) => {
        await addDoc(collectionRef, point);
      })
    );
    console.log("Points of interest saved successfully");
  } catch (error) {
    console.error("Error saving points of interest to Firestore", error);
  }
}

// Define the displayImage function
function displayImage(imageUrl) {
  const imageElement = document.getElementById("waldo-image");
  imageElement.style.backgroundImage = `url(${imageUrl})`;
  imageElement.style.backgroundSize = "cover";
  imageElement.style.backgroundPosition = "center";
  imageElement.style.width = "100%";
  imageElement.style.height = "100%";
}

// Initialize the game
async function initializeGame() {
  // Display the image
  const imageUrl = "https://images4.alphacoders.com/645/thumb-1920-64574.jpg";
  displayImage(imageUrl);

  // Set up event listener for click on the image
  const imageElement = document.getElementById("waldo-image");
  imageElement.addEventListener("click", handleImageClick);
  imageElement.style.cursor = "crosshair";

  // Retrieve points of interest from Firestore
  try {
    const collectionRef = collection(getFirestore(), "pointsOfInterest");
    const pointsOfInterestSnapshot = await getDocs(collectionRef);
    const pointsOfInterest = pointsOfInterestSnapshot.docs.map((doc) =>
      doc.data()
    );

    // Save the retrieved points of interest in a global variable
    window.pointsOfInterest = pointsOfInterest;
  } catch (error) {
    console.error("Error retrieving points of interest from Firestore", error);
  }
}
// Event handler for click on the image
function handleImageClick(event) {
  const { pageX, pageY } = event;
  const toolboxSize = 100; // Size of the toolbox (100px x 100px)

  // Check if there is an existing modal
  const existingModal = document.querySelector(".modal");
  if (existingModal) {
    existingModal.parentNode.removeChild(existingModal);
  }

  // Create and display the modal at the cursor location
  const modal = createModal(pageX, pageY);
  const imageElement = document.getElementById("waldo-image"); // or document.querySelector("main")
  imageElement.appendChild(modal);

  // Add event listener to handle option selection
  modal.addEventListener("click", (event) =>
    handleOptionSelection(event, toolboxSize, pageX, pageY)
  );

  console.log(pageX);
  console.log(pageY);
}

// Create and display the modal at the specified location
function createModal(x, y) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.style.position = "fixed";
  modal.style.left = x + "px";
  modal.style.top = y - 100 + "px";

  // Create and append the list of options
  const options = ["Wally", "Wilma", "Wizard"];
  const list = document.createElement("ul");
  list.style.listStyle = "none";
  list.style.padding = "0";
  list.style.backgroundColor = "blue";
  list.style.color = "blue";

  options.forEach((option) => {
    const listItem = document.createElement("li");
    listItem.textContent = option;
    listItem.style.backgroundColor = "blue";
    listItem.style.color = "white";
    listItem.style.padding = "10px";
    listItem.style.cursor = "pointer";

    // Add hover styles
    listItem.addEventListener("mouseover", () => {
      listItem.style.backgroundColor = "white";
      listItem.style.color = "red";
    });

    listItem.addEventListener("mouseout", () => {
      listItem.style.backgroundColor = "blue";
      listItem.style.color = "white";
    });

    list.appendChild(listItem);
  });

  modal.appendChild(list);

  console.log("modal displayed :)");
  return modal;
}

// Handle option selection
function handleOptionSelection(event, distanceThreshold, clickX, clickY) {
  const selectedOption = event.target.textContent;

  // Check if the selected option is near any point of interest
  const selectedPoint = checkPointOfInterest(
    clickX,
    clickY,
    distanceThreshold,
    selectedOption
  );
  if (selectedPoint) {
    const message = `You found ${selectedPoint.character}!`;
    showRewardMessage(message);
    drawCircle(selectedPoint.x, selectedPoint.y);
  }

  // Remove the modal from the DOM
  const modal = event.target.closest(".modal");
  modal.parentNode.removeChild(modal);
}

function checkPointOfInterest(
  clickX,
  clickY,
  distanceThreshold,
  selectedOption
) {
  const pointsOfInterest = window.pointsOfInterest || [];
  const imageElement = document.getElementById("waldo-image");
  const imageRect = imageElement.getBoundingClientRect();

  for (const point of pointsOfInterest) {
    if (point.character === selectedOption) {
      // Adjust the click coordinates relative to the image element
      const adjustedClickX = clickX - imageRect.left;
      const adjustedClickY = clickY - imageRect.top;

      const distance = Math.sqrt(
        (point.x - adjustedClickX) ** 2 + (point.y - adjustedClickY) ** 2
      );
      if (distance <= distanceThreshold) {
        return point;
      }
    }
  }

  return null;
}

// Show the reward message
function showRewardMessage(message) {
  // Display the message to the user
  alert(message);
  console.log(message);
}

// Draw a circle on the image at the given coordinates
function drawCircle(x, y) {
  // Draw a circle on the image at (x, y) using a canvas or other method
  // Add your implementation here
}

initializeApp(firebaseAppConfig);

const pointsOfInterest = [
  { x: 941, y: 358, character: "Wally" },
  { x: 640, y: 319, character: "Wilma" },
  { x: 1407, y: 845, character: "Wizard" },
];

savePointsOfInterest(pointsOfInterest);

// Call the initializeGame function
initializeGame();

// TODO: Enable Firebase Performance Monitoring.
getPerformance();

initFirebaseAuth();
loadMessages();
