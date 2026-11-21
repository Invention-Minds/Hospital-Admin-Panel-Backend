jest.mock('../../../config/googeCloudStorage', () => ({ __esModule: true, default: {} }));
import { photoType } from '../quality-mobile.controller';

const f = (mimetype: string, bytes: number[] | string) => ({ mimetype, buffer: typeof bytes === 'string' ? Buffer.from(bytes, 'latin1') : Buffer.from(bytes) });

describe('photoType — trusts the bytes when the phone does not label the upload', () => {
  it('keeps an accepted label', () => expect(photoType(f('image/png', [0]))).toBe('image/png'));
  it('detects an unlabelled JPEG', () => expect(photoType(f('application/octet-stream', [0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg'));
  it('detects an unlabelled PNG', () => expect(photoType(f('', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png'));
  it('detects WebP and HEIC', () => {
    expect(photoType(f('application/octet-stream', 'RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(photoType(f('application/octet-stream', '\0\0\0\x18ftypheic\0\0'))).toBe('image/heic');
  });
  it('rejects anything else', () => expect(photoType(f('application/octet-stream', '%PDF-1.7'))).toBeNull());
});
