const { PrismaClient } = require("@prisma/client");
import { Request, Response } from 'express';
import formidable from "formidable";
const fs = require("fs");
const path = require("path");
import { Client } from "basic-ftp";
import { loadTv } from '../appointments/appointment.controller';
const FTP_CONFIG = {
    host: "srv680.main-hosting.eu",  // Your FTP hostname
    user: "u948610439",       // Your FTP username
    password: "Bsrenuk@1993",   // Your FTP password
    secure: false                    // Set to true if using FTPS
};

// const { uploadToFTP } = require("../utils/uploadToFTP");

const prisma = new PrismaClient();

export const getLatestAds = async (req: Request, res: Response) => {
    try {
        const textAd = await prisma.advertisement.findFirst({
            where: { type: "text" },
            orderBy: { uploadedAt: "desc" },
        });

        const mediaAd = await prisma.advertisement.findFirst({
            where: { OR: [{ type: "image" }, { type: "video" }] },
            orderBy: { uploadedAt: "desc" },
        });

        res.json({ textAd, mediaAd });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};
export const getAllAds = async (req: Request, res: Response) => {
    try {
        // ✅ Fetch all ads from DB
        const ads = await prisma.advertisement.findMany({
            orderBy: { uploadedAt: "desc" }, // Latest first
            include: {
                AdvertisementMedia: true // ✅ Include related media
            }
        });

        // ✅ Categorize ads
        const textAd = ads.find((ad:any) => ad.type === "text");
        const imageAd = ads.find((ad:any) => ad.type === "image");
        const videoAd = ads.find((ad:any) => ad.type === "video");

        // ✅ Check which ads are active
        const activeAd = ads.find((ad:any) => ad.isActive === true);

        res.json({
            ads// ✅ Currently enabled ad
        });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};


// ✅ Insert or Update Text Advertisement
export const uploadTextAd = async (req: Request, res: Response) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: "Text content is required" });

        // Check if a text ad already exists
        const existingAd = await prisma.advertisement.findFirst({
            where: { type: "text" },
        });
        let message;
        let updatedAd;
        if (existingAd) {
            // Update existing text ad
            const updatedAd = await prisma.advertisement.update({
                where: { id: existingAd.id },
                data: { content },
            });

            message = "Text ad updated successfully";
        } else {
            // Create new text ad
            const newAd = await prisma.advertisement.create({
                data: { type: "text", content },
            });

            message = "Text ad added successfully";
        }
        loadTv('text');
        res.json({ message, updatedAd });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};
const TEMP_FOLDER = path.join(__dirname, "../../temp");
if (!fs.existsSync(TEMP_FOLDER)) {
    fs.mkdirSync(TEMP_FOLDER, { recursive: true });
}
// ✅ Insert or Update Media Advertisement (Image/Video)
export const uploadMediaAd = async (req: any, res: any) => {
    try {
        const form = formidable({
            uploadDir: TEMP_FOLDER,
            keepExtensions: true,
            multiples: true,
        });

        form.parse(req, async (err, fields, files) => {
            if (err) {
                console.error("Formidable Parse Error:", err);
                return res.status(500).json({ error: err.message });
            }

            const type = fields.type?.[0]; // Get first value as string
            if (!type || (type !== "image" && type !== "video")) {
                return res.status(400).json({ error: "Invalid type (must be 'image' or 'video')" });
            }

            if (!files.file || files.file.length === 0) {
                return res.status(400).json({ error: "No file uploaded" });
            }

            const uploadedFiles = Array.isArray(files.file) ? files.file : [files.file];

            const file = files.file[0];
            console.log(file)
            // const tempFilePath = file.filepath;
            // const fileName = file.originalFilename;

            // // ✅ Ensure file exists before uploading
            // if (!fs.existsSync(tempFilePath)) {
            //     return res.status(500).json({ error: "Temporary file not found after upload." });
            // }
            // const remoteFilePath = `/public_html/docminds/ads_image/${fileName}`;
            // // ✅ Upload to FTP
            // await uploadToFTP(tempFilePath, remoteFilePath); // ✅ Ensures fileUrl is a string
            // const fileUrl = `https://docminds.inventionminds.com/ads_image/${fileName}`;

            // if (!fileUrl || typeof fileUrl !== "string") {
            //     return res.status(500).json({ error: "File upload failed. No file URL generated." });
            // }

            // console.log(fileUrl)
            const uploadedUrls: string[] = [];
            for (const file of uploadedFiles) {
                const tempFilePath = file.filepath;
                const fileName = file.originalFilename;

                const remoteFilePath = `/public_html/docminds/ads_image/${fileName}`;
                await uploadToFTP(tempFilePath, remoteFilePath);
                uploadedUrls.push(`https://docminds.inventionminds.com/ads_image/${fileName}`);

                fs.unlinkSync(tempFilePath); // Clean up temp file
            }

            // ✅ Check if an ad of this type exists
            const existingAd = await prisma.advertisement.findFirst({
                where: { type },
            });
            console.log(existingAd)

            let ad:any;
            let message;

            if (existingAd) {
                // ✅ Update existing ad
                ad = await prisma.advertisement.update({
                    where: { id: existingAd.id },
                    data: { content: uploadedUrls[0], type, isActive: true }, // Use first URL as content
                });

                const mediaData = uploadedUrls.map(url => ({
                    advertisementId: existingAd.id,
                    url,
                    isActive: true
                }));
                await prisma.advertisementMedia.createMany({
                    data: mediaData
                });
                message = "Image ad updated successfully";
            } else {
                // ✅ Create new ad
                ad = await prisma.advertisement.create({
                    data: { type, content: uploadedUrls[0], isActive: true },
                });
                const mediaData = uploadedUrls.map(url => ({
                    advertisementId: ad.id,
                    url,
                    isActive: true
                }));
                await prisma.advertisementMedia.createMany({
                    data: mediaData
                });
                message = "Image ad updated successfully";
            }
            loadTv('image')
            // ✅ Delete temp file after upload
            // fs.unlinkSync(tempFilePath);
            res.json({ message, ad })
        });
    } catch (error) {
        console.error("Upload Error:", error);
        res.status(500).json({ error: (error as Error).message });
    }
};

async function uploadToFTP(localFilePath: string, remoteFileName: string): Promise<any> {
    const client = new Client();
    client.ftp.verbose = true;

    try {
        await client.access(FTP_CONFIG);

        console.log("Connected to FTP Server!");

        // Ensure the directory exists
        // Ensure the "pdfs" directory exists
        // await client.ensureDir("/docminds/pdfs");
        await client.ensureDir("/docminds/ads_image");

        // Upload the file
        await client.uploadFrom(localFilePath, remoteFileName);
        console.log(`Uploaded: ${remoteFileName}`);

        await client.close();

        // ✅ Return the correct public file URL
        
    } catch (error) {
        console.error("FTP Upload Error:", error);
        throw new Error("FTP upload failed");
    }
}


export const updateAdStatus = async (req: Request, res: Response) => {
    try {
        const { type, isActive } = req.body;
        await prisma.advertisement.updateMany({ where: { type }, data: { isActive } });
        loadTv(type);
        res.json({ message: `Ad ${isActive ? "enabled" : "disabled"} successfully.` });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
};


export const toggleMediaStatus = async (req: Request, res: Response) => {
    try {
        const mediaId = Number(req.params.id);
        const { isActive } = req.body;

        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ error: "isActive must be boolean" });
        }

        const updatedMedia = await prisma.advertisementMedia.update({
            where: { id: mediaId },
            data: { isActive }
        });

        res.json({
            message: `Media ${isActive ? "activated" : "deactivated"} successfully`,
            updatedMedia
        });
    } catch (error) {
        console.error("Toggle Media Status Error:", error);
        res.status(500).json({ error: (error as Error).message });
    }
};
export const deleteMedia = async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      await prisma.advertisementMedia.delete({ where: { id } });
      loadTv('image');
      res.json({ message: "Media deleted" });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  };
  
  export const toggleImageMediaStatus = async (req: Request, res: Response) => {
    try {
      const mediaId = Number(req.params.id);
      const { isActive } = req.body;
  
      if (typeof isActive !== 'boolean') {
         res.status(400).json({ error: "isActive must be boolean" });
         return;
      }
  
      const updatedMedia = await prisma.advertisementMedia.update({
        where: { id: mediaId },
        data: { isActive }
      });
  
      res.json({
        message: `Media ${isActive ? "activated" : "deactivated"} successfully`,
        updatedMedia
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  };
  