exports.default = async function notarizeIfConfigured(context) {
  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log('Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID are required.');
    return;
  }
  if (process.platform !== 'darwin') {
    console.log('Skipping notarization: macOS notarization only runs on darwin.');
    return;
  }
  let notarize;
  try {
    ({ notarize } = require('@electron/notarize'));
  } catch (error) {
    throw new Error('@electron/notarize is required when Apple notarization credentials are configured.');
  }
  const appId = context.packager.appInfo.appId;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  await notarize({
    appBundleId: appId,
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
