/**
 * Where a sign-in lands when the user didn't ask for a particular page (i.e.
 * they clicked "Log in" rather than being bounced off a protected route).
 *
 * Their own lists, not the marketing homepage: someone who just signed in came
 * to use the app, and the homepage hero still reads as a pitch to a stranger.
 *
 * Keep in sync with the backend's `DEFAULT_POST_LOGIN_PATH`
 * (backend/app/auth/oauth.py) — that one covers the real Cognito round-trip,
 * which never passes back through this code.
 */
export const DEFAULT_POST_LOGIN_PATH = '/lists'
