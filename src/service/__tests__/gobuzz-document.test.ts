/**
 * sendDocumentTemplate — the exact WhatsApp template payload sent to GoBuzz.
 *
 * Meta rejects a send whose body parameters don't match the approved
 * template, so the positional vs named shape is pinned here.
 */

const postMock = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => postMock(...args) },
}));

import { sendDocumentTemplate } from '../gobuzz-document';

const baseOpts = {
  to: '919888877777',
  templateName: 'opd_consultation_note',
  templateLang: 'en',
  mediaId: 'media-123',
  filename: 'VisitSummary_2026-09-17.pdf',
};

const sentPayload = () => postMock.mock.calls[0][1];
const bodyComponent = () => sentPayload().template.components.find((c: any) => c.type === 'body');

beforeEach(() => {
  postMock.mockReset();
  postMock.mockResolvedValue({ data: { messages: [{ id: 'wamid.1' }] } });
});

describe('sendDocumentTemplate', () => {
  it('sends the PDF as the document header', async () => {
    await sendDocumentTemplate({ ...baseOpts, bodyParams: ['Ramesh', 'A. Rao'] });

    const header = sentPayload().template.components.find((c: any) => c.type === 'header');
    expect(header.parameters).toEqual([
      { type: 'document', document: { id: 'media-123', filename: 'VisitSummary_2026-09-17.pdf' } },
    ]);
    expect(sentPayload().template).toMatchObject({ name: 'opd_consultation_note', language: { code: 'en' } });
  });

  it('sends positional body parameters in order by default', async () => {
    await sendDocumentTemplate({ ...baseOpts, bodyParams: ['Ramesh', 'A. Rao'] });

    expect(bodyComponent().parameters).toEqual([
      { type: 'text', text: 'Ramesh' },
      { type: 'text', text: 'A. Rao' },
    ]);
  });

  it('adds parameter_name to each body parameter for named templates', async () => {
    await sendDocumentTemplate({
      ...baseOpts,
      bodyParams: ['Ramesh', 'A. Rao'],
      bodyParamNames: ['Patient_Name', 'Doctor_Name'],
    });

    expect(bodyComponent().parameters).toEqual([
      { type: 'text', parameter_name: 'Patient_Name', text: 'Ramesh' },
      { type: 'text', parameter_name: 'Doctor_Name', text: 'A. Rao' },
    ]);
  });

  it('refuses to send when the names and values do not line up', async () => {
    await expect(
      sendDocumentTemplate({ ...baseOpts, bodyParams: ['Ramesh', 'A. Rao'], bodyParamNames: ['Patient_Name'] }),
    ).rejects.toThrow('2 body values but 1 parameter names');
    expect(postMock).not.toHaveBeenCalled();
  });
});
