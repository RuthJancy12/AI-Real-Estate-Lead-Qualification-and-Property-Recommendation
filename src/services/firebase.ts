/**
 * Firebase client initialization for LYKA Realty.
 *
 * Config is read from Vite env vars (see .env.example). The values supplied
 * by the project owner are used as fallbacks so the app works even if the
 * .env file is missing. These are PUBLIC web-app identifiers by design —
 * never place service-account private keys in frontend code.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { getDatabase, type Database } from 'firebase/database'

/**
 * Guest-access policy. When false (current), signed-out visitors may use the
 * welcome page, dashboard, and chatbot with on-device storage, while Firebase
 * Authentication stays fully enabled and functional. Set to true to restore
 * hard sign-in gating (chatbot requires login). Auth code itself is never
 * bypassed, faked, or removed — this flag only controls route gating.
 */
export const AUTH_GATE_ENABLED = false

function envOrFallback(envKey: string, fallback: string): string {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[envKey]
    return v && v.trim() ? v.trim() : fallback
  } catch {
    return fallback
  }
}

const firebaseConfig = {
  apiKey: envOrFallback('VITE_FIREBASE_API_KEY', 'AIzaSyB7oPZpG-_VKAFvMXePd6qmZ--cU95pIJU'),
  authDomain: envOrFallback('VITE_FIREBASE_AUTH_DOMAIN', 'real-estimate-6b291.firebaseapp.com'),
  projectId: envOrFallback('VITE_FIREBASE_PROJECT_ID', 'real-estimate-6b291'),
  storageBucket: envOrFallback('VITE_FIREBASE_STORAGE_BUCKET', 'real-estimate-6b291.firebasestorage.app'),
  messagingSenderId: envOrFallback('VITE_FIREBASE_MESSAGING_SENDER_ID', '57626277280'),
  appId: envOrFallback('VITE_FIREBASE_APP_ID', '1:57626277280:web:75428658632388390d60c5'),
  measurementId: envOrFallback('VITE_FIREBASE_MEASUREMENT_ID', 'G-Q123SZT14L'),
  // Verified live instance (see .env). Must match the console URL exactly.
  databaseURL: envOrFallback(
    'VITE_FIREBASE_DATABASE_URL',
    'https://real-estimate-6b291-default-rtdb.firebaseio.com'
  )
}

const app: FirebaseApp = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig)

export const auth: Auth = getAuth(app)

/** Realtime Database handle. Reads/writes still require auth per DB rules. */
export const db: Database = getDatabase(app)

/** Google provider for optional Google Sign-In (must be enabled in console). */
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export default app
