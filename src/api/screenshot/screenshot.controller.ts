import { Request, Response } from 'express';
import * as puppeteer from 'puppeteer';
import { Client } from "basic-ftp";
import axios from 'axios';

import fs from 'fs';
import path from 'path';

const FTP_CONFIG = {
    host: "srv680.main-hosting.eu",  // Your FTP hostname
    user: "u948610439",       // Your FTP username
    password: "Bsrenuk@1993",   // Your FTP password
    secure: false                    // Set to true if using FTPS
};

class ScreenshotController {
    static async captureDashboard(): Promise<void> {
        try {
            const browser = await puppeteer.launch({ headless: true });
            const page = await browser.newPage();

            await page.setViewport({ width: 1920, height: 1080 })
            // Open the login page
            await page.goto('https://rashtrotthanahospital.docminds.in/login', { waitUntil: 'networkidle2' });

            // Perform login
            
            await page.type('input[name="username"]', 'DocMinds01');
            await page.type('input[name="password"]', 'docminds@0911');
            await Promise.all([
                page.click('form button[type="submit"]'),
                page.waitForNavigation({ waitUntil: 'networkidle2' }) // Wait for dashboard to load
            ]);

            // Navigate to the dashboard
            await page.goto('https://rashtrotthanahospital.docminds.in/analytics', { waitUntil: 'networkidle2' });
            console.log("⏳ Waiting for 30 seconds to load all data...");
            await new Promise(resolve => setTimeout(resolve, 30000));

            // Scroll to load all content
            await autoScroll(page);

            // Store screenshot
            const screenshotDir = path.join(__dirname, '../../screenshots');
            if (!fs.existsSync(screenshotDir)) {
                fs.mkdirSync(screenshotDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const screenshotFileName = `dashboard-${timestamp}.png`;
            const screenshotPath = path.resolve(screenshotDir, screenshotFileName); // Normalize path

            console.log("🛠️ Screenshot Path (Local):", screenshotPath);
            const remoteFilePath = `/public_html/docminds/images/${screenshotFileName}`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            // Upload to FTP and delete local file after upload
            const imageUrl = await uploadToFTP(screenshotPath, remoteFilePath);



            await browser.close();

            // res.sendFile(screenshotPath);
            await sendWhatsAppMessage(imageUrl);
        } catch (error) {
            console.error('Error capturing screenshot:', error);
            // res.status(500).json({ error: 'Screenshot failed' });
        }
    }
}
async function uploadToFTP(localFilePath: string, remoteFilePath: string) {
    const client = new Client();
    client.ftp.verbose = true; // Enable logs

    try {
        await client.access(FTP_CONFIG);
        console.log("✅ Connected to FTP Server!");

        // Ensure the "images" directory exists inside /docminds
        await client.ensureDir("/docminds/images");
        const imageUrl = `https://inventionminds.com/docminds/images/${path.basename(remoteFilePath)}`
        // Upload the file
        await client.uploadFrom(localFilePath, remoteFilePath);
        console.log(`✅ Uploaded: ${remoteFilePath}`);

        // Delete local file after upload
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
            console.log(`🗑️ Deleted local file: ${localFilePath}`);
        }

        await client.close();
        return imageUrl
    } catch (error) {
        console.error("❌ FTP Upload Error:", error);
    }
}
// Fixed autoScroll function
async function autoScroll(page: puppeteer.Page) {
    await page.evaluate(() => {
        return new Promise<void>((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}
function formatDateYear(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
    const year = date.getFullYear().toString().slice(-4); // Get last two digits of year
    return `${day}-${month}-${year}`;
  }
async function sendWhatsAppMessage(imageUrl: any) {
    try {
        const todayDate = new Date().toISOString().split('T')[0];
        const fromPhoneNumber = process.env.WHATSAPP_FROM_PHONE_NUMBER;
        const url = process.env.WHATSAPP_API_URL_BULK;
        console.log(todayDate)
        const payload = {
            from: fromPhoneNumber,
            // to: ["919496217976", "919341227264", "919995703633 ","919880544866","916364833988","919342003000"], // Recipient's WhatsApp number
            to:['919342287945'],
            // to:['919342003000'],
            type: "template",
            message: {
                templateid: "735729", // Use your actual template ID
                url: imageUrl, // Extracts PDF name
                placeholders: [formatDateYear(new Date(todayDate))]
            }
        };

        const headers = {
            "Content-Type": "application/json",
            apikey: process.env.WHATSAPP_AUTH_TOKEN, // API key from Pinnacle
        };

        const response = await axios.post(url!, payload, { headers });

        if (response.data.code === "200") {
            console.log("✅ WhatsApp message sent successfully:", response.data);

            return response;
        } else {
            console.error("❌ Failed to send WhatsApp message:", response.data);
            throw new Error("WhatsApp API failed");
        }
    } catch (error) {
        console.error("❌ WhatsApp API Error:", error);
        throw error;
    }
}
export default ScreenshotController;
