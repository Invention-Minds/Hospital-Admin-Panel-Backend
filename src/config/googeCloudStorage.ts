import { Storage } from '@google-cloud/storage';
import path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();
const storage = new Storage({
  keyFilename: path.join(__dirname, '../../cred.json'),
});

const bucketName = 'rashtrotthana_bucket';
const bucket = storage.bucket(bucketName);
export default bucket;