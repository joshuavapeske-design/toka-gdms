// TOKA GDMS — Africa's Talking SMS Gateway Integration

export interface SendSmsParams {
  to: string;
  message: string;
  deliveryReference?: string;
}

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends an SMS message via Africa's Talking API
 * Falls back to simulation mode in development or if credentials are not configured.
 */
export async function sendSms({ to, message, deliveryReference }: SendSmsParams): Promise<SmsSendResult> {
  const username = process.env.AFRICAS_TALKING_USERNAME;
  const apiKey = process.env.AFRICAS_TALKING_API_KEY;
  const senderId = process.env.AFRICAS_TALKING_SENDER_ID || 'TOKA_GLASS';

  // Format recipient phone number to E.164 (Kenya +254)
  let formattedPhone = to.trim();
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+254' + formattedPhone.slice(1);
  } else if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+254' + formattedPhone;
  }

  // Development / Simulation Mode
  if (!username || !apiKey || username === 'sandbox' || apiKey === 'placeholder') {
    console.log(`[SMS SIMULATION] To: ${formattedPhone} | From: ${senderId} | Ref: ${deliveryReference || 'N/A'}`);
    console.log(`[SMS SIMULATION] Body:\n${message}\n`);
    return {
      success: true,
      messageId: `sim-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    };
  }

  try {
    const isSandbox = username.toLowerCase() === 'sandbox';
    const baseUrl = isSandbox
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';

    const params = new URLSearchParams();
    params.append('username', username);
    params.append('to', formattedPhone);
    params.append('message', message);
    if (!isSandbox && senderId) {
      params.append('from', senderId);
    }

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        apiKey: apiKey,
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    const data = await response.json();
    const recipientData = data?.SMSMessageData?.Recipients?.[0];

    if (recipientData && (recipientData.status === 'Success' || recipientData.statusCode === 101)) {
      return {
        success: true,
        messageId: recipientData.messageId,
      };
    } else {
      return {
        success: false,
        error: recipientData?.status || data?.SMSMessageData?.Message || 'SMS delivery failed',
      };
    }
  } catch (err: any) {
    console.error('[SMS ERROR] Africa\'s Talking request failed:', err);
    return {
      success: false,
      error: err.message || 'SMS service unavailable',
    };
  }
}

/**
 * Generates the standardized Delivery Notification SMS template
 */
export function generateDeliveryNotificationSms({
  deliveryReference,
  totalAmount,
  totalPaid,
  outstandingBalance,
  itemSummary,
}: {
  deliveryReference: string;
  totalAmount: number;
  totalPaid: number;
  outstandingBalance: number;
  itemSummary: string;
}): string {
  const formatter = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });
  const totalStr = formatter.format(totalAmount);
  const paidStr = formatter.format(totalPaid);
  const balStr = formatter.format(outstandingBalance);

  return (
    `TOKA GLASS DELIVERY: ${deliveryReference}\n` +
    `Items: ${itemSummary}\n` +
    `Total: KES ${totalStr} | Paid: KES ${paidStr} | Bal: KES ${balStr}\n` +
    `To confirm received, reply: 1\n` +
    `To report an issue or dispute, reply: 2\n` +
    `Helpline: 0700000000`
  );
}

