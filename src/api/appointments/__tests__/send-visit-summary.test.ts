/**
 * OPD visit summary → patient WhatsApp.
 *
 * The caller names the visit (appointmentId); the server derives the
 * recipient from the registered patient record, stores the PDF under an
 * unguessable name, and records every confirmed send in AppAuditLog. Those
 * rows pick the initial vs "updated" template for later sends.
 */

import type { Request, Response } from 'express';

const appointmentMock = { findUnique: jest.fn(), update: jest.fn() };
const patientDetailsMock = { findUnique: jest.fn() };
const appAuditLogMock = { count: jest.fn() };
const opdAssessmentMock = { findFirst: jest.fn() };

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    appointment: appointmentMock,
    patientDetails: patientDetailsMock,
    appAuditLog: appAuditLogMock,
    oPDAssessment: opdAssessmentMock,
  })),
  AppointmentStatus: { pending: 'pending', completed: 'completed', confirmed: 'confirmed', cancelled: 'cancelled' },
}));

jest.mock('../appointment.resolver', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../appointment.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../doctor/doctor.repository', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../whatsapp/whatsapp.controller', () => ({
  sendConfirmedWhatsApp: jest.fn(),
}));
jest.mock('../../sms/sms.controller', () => ({
  sendConfirmedSMS: jest.fn(),
}));
jest.mock('../../../index', () => ({
  notifyPendingAppointments: jest.fn(),
}), { virtual: true });

const saveBufferToStorageMock = jest.fn();
jest.mock('../../../service/local-file-store', () => ({
  saveBufferToStorage: (...args: unknown[]) => saveBufferToStorageMock(...args),
}));

const uploadMediaMock = jest.fn();
const sendDocumentTemplateMock = jest.fn();
jest.mock('../../../service/gobuzz-document', () => ({
  uploadMediaToGoBuzz: (...args: unknown[]) => uploadMediaMock(...args),
  sendDocumentTemplate: (...args: unknown[]) => sendDocumentTemplateMock(...args),
  formatGoBuzzPhone: (p: string) => `91${p.replace(/\D/g, '').slice(-10)}`,
}));

const auditLogMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../service/app-audit', () => ({
  auditLog: (...args: unknown[]) => auditLogMock(...args),
}));

import { sendVisitSummary } from '../appointment.controller';

const PDF_BASE64 = Buffer.from('%PDF-1.3\n...fake pdf body...').toString('base64');

const appointment = {
  id: 55,
  prnNumber: 1042,
  patientName: 'Ramesh',
  phoneNumber: '9000000001',
  date: '2026-09-17',
  doctorName: 'Dr. Booked Consultant',
};

const buildReq = (body: Record<string, unknown>): Request =>
  ({ body, user: { id: 7, username: 'dr.rao' }, headers: {} } as unknown as Request);

const buildRes = () => {
  const res: Partial<Response> & { statusCode?: number; body?: any } = {};
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((payload: any) => {
    res.body = payload;
    return res;
  });
  return res as Response & { statusCode?: number; body?: any };
};

const run = async (body: Record<string, unknown>) => {
  const res = buildRes();
  await sendVisitSummary(buildReq(body), res);
  return res;
};

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME = 'opd_summary_v1';
  process.env.GOBUZZ_OPD_SUMMARY_UPDATE_TEMPLATE_NAME = 'opd_summary_updated_v1';
  delete process.env.GOBUZZ_OPD_SUMMARY_PARAM_NAMES;

  appointmentMock.findUnique.mockResolvedValue({ ...appointment });
  opdAssessmentMock.findFirst.mockResolvedValue({ doctorName: 'Dr. A. Rao', consultant: 'Dr. Consultant' });
  patientDetailsMock.findUnique.mockResolvedValue({ name: 'Ramesh Kumar Rao', mobileNo: '9888877777' });
  appAuditLogMock.count.mockResolvedValue(0);
  saveBufferToStorageMock.mockImplementation((_buf: Buffer, subdir: string, name: string) => ({
    fileName: name,
    filePath: `/tmp/${subdir}/${name}`,
    relativeUrl: `/files/${subdir}/${name}`,
    absoluteUrl: `/files/${subdir}/${name}`,
  }));
  uploadMediaMock.mockResolvedValue('media-123');
  sendDocumentTemplateMock.mockResolvedValue({ data: { messages: [{ id: 'wamid.abc' }] } });
});

afterAll(() => {
  process.env = originalEnv;
});

describe('sendVisitSummary', () => {
  it('sends to the registered mobile number with the registered name', async () => {
    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(200);
    expect(sendDocumentTemplateMock).toHaveBeenCalledWith(expect.objectContaining({
      to: '919888877777',
      templateName: 'opd_summary_v1',
      mediaId: 'media-123',
      filename: 'VisitSummary_2026-09-17.pdf',
      bodyParams: ['Ramesh Kumar Rao', 'Dr. A. Rao'],
    }));
    // Positional by default — no parameter names unless configured.
    expect(sendDocumentTemplateMock.mock.calls[0][0]).not.toHaveProperty('bodyParamNames');
    expect(res.body).toMatchObject({ success: true, template: 'initial', sentTo: '******7777' });
  });

  it('uses the note author as the doctor, sent exactly as stored', async () => {
    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(opdAssessmentMock.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { appointmentId: 55 } }));
    expect(sendDocumentTemplateMock.mock.calls[0][0].bodyParams[1]).toBe('Dr. A. Rao');
  });

  it('never adds a "Dr." prefix the stored name does not have', async () => {
    opdAssessmentMock.findFirst.mockResolvedValue({ doctorName: 'Meena Shah' });

    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(sendDocumentTemplateMock.mock.calls[0][0].bodyParams[1]).toBe('Meena Shah');
  });

  it('falls back to the assessment consultant, then the booked doctor', async () => {
    opdAssessmentMock.findFirst.mockResolvedValue({ doctorName: ' ', consultant: 'Dr. Consultant' });
    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });
    expect(sendDocumentTemplateMock.mock.calls[0][0].bodyParams[1]).toBe('Dr. Consultant');

    sendDocumentTemplateMock.mockClear();
    opdAssessmentMock.findFirst.mockResolvedValue(null);
    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });
    expect(sendDocumentTemplateMock.mock.calls[0][0].bodyParams[1]).toBe('Dr. Booked Consultant');
  });

  it('rejects a visit with no doctor name anywhere', async () => {
    opdAssessmentMock.findFirst.mockResolvedValue(null);
    appointmentMock.findUnique.mockResolvedValue({ ...appointment, doctorName: '' });

    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(400);
    expect(sendDocumentTemplateMock).not.toHaveBeenCalled();
  });

  it('sends named parameters when GOBUZZ_OPD_SUMMARY_PARAM_NAMES is set', async () => {
    process.env.GOBUZZ_OPD_SUMMARY_PARAM_NAMES = ' Patient_Name , Doctor_Name ';

    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(sendDocumentTemplateMock.mock.calls[0][0]).toMatchObject({
      bodyParams: ['Ramesh Kumar Rao', 'Dr. A. Rao'],
      bodyParamNames: ['Patient_Name', 'Doctor_Name'],
    });
  });

  it("surfaces GoBuzz's rejection reason instead of a bare HTTP error", async () => {
    const axiosError: any = new Error('Request failed with status code 400');
    axiosError.response = {
      data: { error: { message: '(#132000) Number of parameters does not match', error_data: { details: 'body: expected 2, got 1' } } },
    };
    sendDocumentTemplateMock.mockRejectedValue(axiosError);

    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toBe('WhatsApp send rejected: body: expected 2, got 1');
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('ignores any phone number or name the caller sends', async () => {
    await run({
      appointmentId: 55,
      pdfBase64: PDF_BASE64,
      patientPhoneNumber: '9111111111',
      patientName: 'Someone Else',
    });

    const sent = sendDocumentTemplateMock.mock.calls[0][0];
    expect(sent.to).toBe('919888877777');
    expect(sent.bodyParams).toEqual(['Ramesh Kumar Rao', 'Dr. A. Rao']);
  });

  it('falls back to the appointment phone and name when the patient record has none', async () => {
    patientDetailsMock.findUnique.mockResolvedValue({ name: '  ', mobileNo: null });

    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    const sent = sendDocumentTemplateMock.mock.calls[0][0];
    expect(sent.to).toBe('919000000001');
    expect(sent.bodyParams).toEqual(['Ramesh', 'Dr. A. Rao']);
  });

  it('stores the PDF under an unguessable name, not a PRN/date pattern alone', async () => {
    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    const storedName: string = saveBufferToStorageMock.mock.calls[0][2];
    expect(storedName).toMatch(
      /^VisitSummary_1042_2026-09-17_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
    );
  });

  it('uses the updated template once this visit has already been sent', async () => {
    appAuditLogMock.count.mockResolvedValue(1);

    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(appAuditLogMock.count).toHaveBeenCalledWith({
      where: { module: 'opd-visit-summary', action: 'WHATSAPP_SENT', entityType: 'Appointment', entityId: '55' },
    });
    expect(sendDocumentTemplateMock.mock.calls[0][0].templateName).toBe('opd_summary_updated_v1');
    expect(res.body.template).toBe('updated');
  });

  it('falls back to the initial template when no update template is configured', async () => {
    appAuditLogMock.count.mockResolvedValue(2);
    delete process.env.GOBUZZ_OPD_SUMMARY_UPDATE_TEMPLATE_NAME;

    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(sendDocumentTemplateMock.mock.calls[0][0].templateName).toBe('opd_summary_v1');
  });

  it('writes one audit row on a confirmed send', async () => {
    await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(auditLogMock).toHaveBeenCalledTimes(1);
    expect(auditLogMock.mock.calls[0][1]).toMatchObject({
      module: 'opd-visit-summary',
      action: 'WHATSAPP_SENT',
      entityType: 'Appointment',
      entityId: 55,
      payload: expect.objectContaining({ prn: 1042, template: 'initial', sentTo: '******7777', messageId: 'wamid.abc' }),
    });
  });

  it('writes no audit row when GoBuzz does not confirm the send', async () => {
    sendDocumentTemplateMock.mockResolvedValue({ data: { error: 'template mismatch' } });

    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(502);
    expect(auditLogMock).not.toHaveBeenCalled();
  });

  it('reports a missing template before uploading anything', async () => {
    delete process.env.GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME;

    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain('GOBUZZ_OPD_SUMMARY_TEMPLATE_NAME');
    expect(uploadMediaMock).not.toHaveBeenCalled();
  });

  it('404s for an unknown appointment', async () => {
    appointmentMock.findUnique.mockResolvedValue(null);

    const res = await run({ appointmentId: 999, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(404);
    expect(sendDocumentTemplateMock).not.toHaveBeenCalled();
  });

  it('rejects an appointment without a PRN', async () => {
    appointmentMock.findUnique.mockResolvedValue({ ...appointment, prnNumber: null });

    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(400);
    expect(sendDocumentTemplateMock).not.toHaveBeenCalled();
  });

  it('rejects when there is no phone number anywhere', async () => {
    patientDetailsMock.findUnique.mockResolvedValue(null);
    appointmentMock.findUnique.mockResolvedValue({ ...appointment, phoneNumber: '' });

    const res = await run({ appointmentId: 55, pdfBase64: PDF_BASE64 });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('No phone number');
  });

  it('rejects a payload that is not a PDF', async () => {
    const res = await run({ appointmentId: 55, pdfBase64: Buffer.from('<html>nope</html>').toString('base64') });

    expect(res.statusCode).toBe(400);
    expect(saveBufferToStorageMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ pdfBase64: PDF_BASE64 }],
    [{ appointmentId: 'abc', pdfBase64: PDF_BASE64 }],
    [{ appointmentId: 55 }],
  ])('requires a valid appointmentId and pdfBase64 (%j)', async (body) => {
    const res = await run(body as Record<string, unknown>);

    expect(res.statusCode).toBe(400);
    expect(appointmentMock.findUnique).not.toHaveBeenCalled();
  });
});
