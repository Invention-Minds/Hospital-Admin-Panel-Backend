jest.mock('../../../service/prisma-client', () => ({ __esModule: true, default: {} }));
jest.mock('../../appointments/appointment.controller', () => ({ notifyConsultationStarted: jest.fn() }));
jest.mock('../../../service/app-audit', () => ({ auditLog: jest.fn() }));

import { joinPlan, splitPlan, visitState } from '../doctor-opd-mobile.controller';

describe('visitState', () => {
  it('maps the web booleans to one state', () => {
    expect(visitState({ checkedOut: false, endConsultation: null, postPond: null })).toBe('waiting');
    expect(visitState({ checkedOut: null, endConsultation: null, postPond: true })).toBe('postponed');
    expect(visitState({ checkedOut: true, endConsultation: null, postPond: null })).toBe('in_consultation');
    expect(visitState({ checkedOut: true, endConsultation: false, postPond: true })).toBe('in_consultation');
    expect(visitState({ checkedOut: true, endConsultation: true, postPond: null })).toBe('done');
  });
});

describe('diagnosis stored inside treatmentPlan', () => {
  it('round-trips diagnosis and plan', () => {
    const stored = joinPlan('Type 2 diabetes, uncontrolled', 'Metformin 500 BD\nReview in 2 weeks');
    expect(stored).toBe('Diagnosis: Type 2 diabetes, uncontrolled\n\nMetformin 500 BD\nReview in 2 weeks');
    expect(splitPlan(stored)).toEqual({ diagnosis: 'Type 2 diabetes, uncontrolled', treatmentPlan: 'Metformin 500 BD\nReview in 2 weeks' });
  });

  it('handles only one half', () => {
    expect(joinPlan('', 'Rest')).toBe('Rest');
    expect(joinPlan('Viral fever', '')).toBe('Diagnosis: Viral fever');
    expect(splitPlan('Diagnosis: Viral fever')).toEqual({ diagnosis: 'Viral fever', treatmentPlan: '' });
    expect(joinPlan('  ', '  ')).toBeNull();
  });

  it('leaves web-written plans untouched', () => {
    expect(splitPlan('Tab PCM 650 SOS')).toEqual({ diagnosis: '', treatmentPlan: 'Tab PCM 650 SOS' });
    expect(splitPlan(null)).toEqual({ diagnosis: '', treatmentPlan: '' });
  });
});
