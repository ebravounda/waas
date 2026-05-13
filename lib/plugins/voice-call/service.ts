// STUB: voice-call plugin is not installed in this license tier.
// All functions throw "Plugin not installed" to allow build to pass.
// Install the voice-call plugin to enable Twilio voice calling features.

const PLUGIN_NOT_INSTALLED = 'voice-call plugin is not installed';

export async function getCreditsBalance(_teamId: number): Promise<number> {
  return 0;
}

export async function generateClientToken(
  _params: { teamId: number; userId: number }
): Promise<{ token: string; identity: string }> {
  throw new Error(PLUGIN_NOT_INSTALLED);
}

export async function handleCallStatusUpdate(
  _callSid: string,
  _callStatus: string,
  _callDuration?: number,
  _recordingUrl?: string,
  _recordingSid?: string,
): Promise<void> {
  // No-op: voice-call plugin not installed
}

export async function addCredits(
  _teamId: number,
  _amount: number,
  _stripeSubscriptionId?: string,
  _description?: string,
): Promise<void> {
  // No-op: voice-call plugin not installed
}

export async function provisionPhoneNumber(
  _teamId: number,
  _phoneNumber: string,
  _subscriptionId: string,
): Promise<void> {
  // No-op: voice-call plugin not installed
}
