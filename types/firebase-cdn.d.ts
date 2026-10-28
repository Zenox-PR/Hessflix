// Les types npm correspondent exactement à la version du SDK chargée depuis le CDN.
declare module 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js' {
  export { getApps, initializeApp } from 'firebase/app';
}
declare module 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js' {
  export { getAuth, GoogleAuthProvider, onIdTokenChanged, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail, signOut } from 'firebase/auth';
}
