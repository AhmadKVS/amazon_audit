import { UserManager } from "oidc-client-ts";

const cognitoAuthConfig = {
  authority: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_xC718su5e",
  client_id: "1im3naftb9fe41t6jqdmsapbcv",
  redirect_uri: "https://main.d1u39ljkdlo7q9.amplifyapp.com/callback",
  response_type: "code",
  scope: "phone openid email",
};

export const userManager = new UserManager({
  ...cognitoAuthConfig,
});

export async function signOutRedirect() {
  const clientId = "1im3naftb9fe41t6jqdmsapbcv";
  const logoutUri = "https://main.d1u39ljkdlo7q9.amplifyapp.com";
  const cognitoDomain = "https://us-east-2xc718su5e.auth.us-east-2.amazoncognito.com";
  await userManager.removeUser();
  window.location.href = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri)}`;
}
