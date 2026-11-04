import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// GarageLog Web App Firebase Configuration
export const firebaseConfig = {
  projectId: "garagelog-kt-234",
  appId: "1:452441306105:web:198bc99f8377caab910328",
  storageBucket: "garagelog-kt-234.firebasestorage.app",
  apiKey: "AIzaSyBSlj-XY2F7gGW4mV9mC3aIHBBjLSaxcOQ",
  authDomain: "garagelog-kt-234.firebaseapp.com",
  messagingSenderId: "452441306105"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app, auth };
