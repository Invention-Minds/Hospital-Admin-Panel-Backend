import { Request, Response } from 'express';
import axios from 'axios';

export const handleWebhook = async (req: Request, res: Response) => {
  const { apiKey, whatsappNumber } = req.params;
  const body = req.body;

  try {
    const from = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    console.log('Received webhook:', body);
    const text = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body;

    if (from && text) {
      console.log(`📩 Message from ${from}: ${text}`);
      await sendTextMessage(from, `Hello! You said: "${text}".`);

      res.status(200).send('Message processed');
    } else {
      res.status(200).send('No text message received');
    }
  } catch (err) {
    console.error('❌ Webhook error:', err);
    res.status(500).send('Server error');
  }
};

const sendTextMessage = async (to: string, message: string) => {
  try {
    const response = await axios.post(
      process.env.WHATSAPP_API_URL!,
      {
        recipient: to,
        type: 'text',
        text: { body: message },
      },
      {
        headers: {
            "Content-Type": "application/json",
            apikey: process.env.WHATSAPP_AUTH_TOKEN,
          }
      }
    );

    console.log('✅ Sent response:', response.data);
  } catch (err: any) {
    console.error('❌ Error sending message:', err.response?.data || err.message);
  }
};
export const handleDeliveryStatus = async (req: Request, res: Response) => {
    const body = req.body;
    const statusData = body.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
  
    if (!statusData) {
      return res.status(400).json({ message: 'Invalid delivery status payload' });
    }
  
    const messageId = statusData.id;
    const recipient = statusData.recipient_id;
    const status = statusData.status; // sent, delivered, read, failed, deleted
    const timestamp = statusData.timestamp;
    const category = statusData.pricing?.category;
    const originType = statusData.conversation?.origin?.type;
  
    console.log(`📬 Delivery Update:
    - Message ID: ${messageId}
    - Recipient: ${recipient}
    - Status: ${status}
    - Category: ${category}
    - Origin: ${originType}
    - Timestamp: ${timestamp}`);
  
    res.status(200).send('Delivery status received');
  };
  