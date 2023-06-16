/**
 * To find your Firebase config object:
 *
 * 1. Go to your [Project settings in the Firebase console](https://console.firebase.google.com/project/_/settings/general/)
 * 2. In the "Your apps" card, select the nickname of the app for which you need a config object.
 * 3. Select Config from the Firebase SDK snippet pane.
 * 4. Copy the config object snippet, then add it here.
 */
const config = {
  /* TODO: ADD YOUR FIREBASE CONFIGURATION OBJECT HERE */

  apiKey: "AIzaSyAyPeRtFMNYkopzX0Jyum7esEXjC6GKtRc",
  authDomain: "friendlychat-5070c.firebaseapp.com",
  projectId: "friendlychat-5070c",
  storageBucket: "friendlychat-5070c.appspot.com",
  messagingSenderId: "138361561255",
  appId: "1:138361561255:web:1e0780de2afef84a7afb82"
};

export function getFirebaseConfig() {
  if (!config || !config.apiKey) {
    throw new Error(
      "No Firebase configuration object provided." +
        "\n" +
        "Add your web app's configuration object to firebase-config.js"
    );
  } else {
    return config;
  }
}
