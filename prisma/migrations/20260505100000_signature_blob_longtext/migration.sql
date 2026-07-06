-- Bug fix: SignatureBlob.blobUrl was VARCHAR(191), but the schema's intent
-- (per the model comment) is to hold either a data: URI for inline base64
-- images or an object-storage URL. A typical signature data URI is several
-- KB — way past 191 chars — and `prisma.signatureBlob.create()` was failing
-- with P2000 "value too long for the column's type".
--
-- Switch to LONGTEXT (4GB cap) which matches the existing `@db.LongText`
-- pattern used elsewhere in the schema for image/blob fields.

-- AlterTable
ALTER TABLE `SignatureBlob` MODIFY `blobUrl` LONGTEXT NOT NULL;
