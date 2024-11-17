import { Request, Response } from 'express';
import bucket from '../../config/googeCloudStorage'

// Function to upload an image to Google Cloud Storage
export const uploadImage = async (req: Request, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).send('No file uploaded.');
    return;
  }

  try {
    const blob = bucket.file(req.file.originalname);
    const blobStream = blob.createWriteStream({
      resumable: false,
    });

    blobStream.on('error', (err) => res.status(500).send(err.message));

    blobStream.on('finish', () => {
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
      console.log(publicUrl);
      res.status(200).send({ publicUrl });
    });

    blobStream.end(req.file.buffer);
  } catch (error) {
    res.status(500).send('Upload failed.');
  }
};

// Function to delete files older than 7 days
export const deleteOldFiles = async (): Promise<void> => {
  try {
    const [files] = await bucket.getFiles();
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    files.forEach((file) => {
      file.getMetadata().then(([metadata]) => {
        if(metadata.timeCreated != undefined) {
        const createdAt = new Date(metadata.timeCreated).getTime();
        if (now - createdAt > sevenDays) {
          file.delete().then(() => {
            console.log(`Deleted old file: ${file.name}`);
          });
        }
    }
      });
    
    });
  } catch (error) {
    console.error('Error deleting old files:', error);
  }
};
