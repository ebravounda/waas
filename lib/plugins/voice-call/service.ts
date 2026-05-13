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
  _recordingUrl?: string | null,
  _recordingSid?: string | null,
): Promise<void> {}

export async function addCredits(
  _teamId: number,
  _amount: number,
  _stripeSubscriptionId?: string | null,
  _description?: string | null,
): Promise<void> {}

export async function provisionPhoneNumber(
  _teamId: number,
  _phoneNumber: string,
  _subscriptionId: string | null,
): Promise<void> {}
