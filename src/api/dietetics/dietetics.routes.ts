import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';
import { requireRole } from '../../middleware/require-role';
import { NURSE_SUBTYPES, NURSING_SUPERINTENDENT } from '../_shared/nursing-roles';

import {
  listMealTimeSlots, upsertMealTimeSlot,
  listAllergens, upsertAllergen,
  listDiets, upsertDiet,
  listMeals, upsertMeal,
  getMenuForDiet, upsertMenuCell, clearMenuCell,
  listDrugFoodInteractions, getInteractionsForAdmission,
  listTextures, upsertTexture,
  listSupplements, upsertSupplement,
  getSettings, updateSettings,
} from './masters.controller';

import {
  getCurrentForAdmission, getHistoryForAdmission,
  upsertDraft, signPlan, endPlan, getQueue,
} from './diet-plan.controller';

import {
  getKitchenList, getForAdmission, getTvSnapshot,
  markPlated, markDelivered, recordIntake, skipMeal,
  listCanteenChannels, upsertCanteenChannel,
  regenerateForDate,
  markOrdersBilled, getBillingList,
  listExtraFood, createExtraFood, updateExtraFood, markExtraFoodBilled,
  listAlerts, acknowledgeAlerts,
  getLabels,
} from './meal-order.controller';

import {
  getSheetPreview, updateCell, issueSheet, acknowledgeSheet, listSheets, getSheet,
  listHolds, createHold, liftHold, getDietHistory,
} from './sheet.controller';

import {
  listCensusWards, getCensusPrefill, submitCensus, listCensus, getCensus,
  receiveCensus, acknowledgeCensus,
} from './census.controller';

import {
  createAssessment, createNote, getNutritionForAdmission, getRoundsList,
} from './nutrition.controller';

const router = express.Router();

// ─── Write permissions (checked against the DB, mirrors the sidebar) ──
// super_admin passes every guard by default. The doctor does NOT prescribe
// diet — they record the initial assessment; the dietitian prescribes.
const DIETICIAN = ['Dietician', 'Diet'];
const CANTEEN = ['Canteen Staff'];
const BILLING = ['Billing Coordinator'];
const NURSES = [...NURSE_SUBTYPES, NURSING_SUPERINTENDENT];

/** Dietetics → Setup: masters, settings, TV channels. */
const setupAdmin = requireRole({ roles: [] });
/** Dietitian: diet plans, sheet cells + issue, nutrition screening, notes. */
const dietitian = requireRole({ subAdminTypes: DIETICIAN });
/** Nursing: send the daily census. */
const nursing = requireRole({ subAdminTypes: NURSES });
/** Dietary department (kitchen staff + dietitian): census inbox, alerts, holds. */
const dietary = requireRole({ subAdminTypes: [...CANTEEN, ...DIETICIAN] });
/** F&B manager / supervisor (Canteen Staff): confirms the issued diet sheet reached the kitchen. */
const fnbSupervisor = requireRole({ subAdminTypes: CANTEEN });
/** Tray handling: prepare, serve, intake, skip — kitchen staff + ward nurses. */
const canteenFloor = requireRole({ subAdminTypes: [...CANTEEN, ...NURSE_SUBTYPES] });
/** Regenerate / sync orders. */
const orderSync = requireRole({ subAdminTypes: [...CANTEEN, ...NURSE_SUBTYPES, ...DIETICIAN] });
/** Extra food requests: anyone on the ward or in dietary. */
const extraFood = requireRole({ subAdminTypes: [...CANTEEN, ...DIETICIAN, ...NURSES] });
/** Billed flag. */
const billing = requireRole({ subAdminTypes: [...CANTEEN, ...BILLING] });

// ─── Masters — diets, meals, allergens, slots, menus, textures, supplements ─
// Reads: any authenticated user. Writes: super_admin only.
router.get('/meal-time-slots', authenticateToken, listMealTimeSlots);
router.post('/meal-time-slots', authenticateToken, setupAdmin, requireClinicalActor, upsertMealTimeSlot);
router.put('/meal-time-slots/:id', authenticateToken, setupAdmin, requireClinicalActor, upsertMealTimeSlot);

router.get('/allergens', authenticateToken, listAllergens);
router.post('/allergens', authenticateToken, setupAdmin, requireClinicalActor, upsertAllergen);
router.put('/allergens/:id', authenticateToken, setupAdmin, requireClinicalActor, upsertAllergen);

router.get('/diets', authenticateToken, listDiets);
router.post('/diets', authenticateToken, setupAdmin, requireClinicalActor, upsertDiet);
router.put('/diets/:id', authenticateToken, setupAdmin, requireClinicalActor, upsertDiet);

router.get('/meals', authenticateToken, listMeals);
router.post('/meals', authenticateToken, setupAdmin, requireClinicalActor, upsertMeal);
router.put('/meals/:id', authenticateToken, setupAdmin, requireClinicalActor, upsertMeal);

router.get('/menu/:dietMasterId', authenticateToken, getMenuForDiet);
router.post('/menu', authenticateToken, setupAdmin, requireClinicalActor, upsertMenuCell);
router.delete('/menu/:dietMasterId/:mealTimeSlotId/:dayOfWeek', authenticateToken, setupAdmin, requireClinicalActor, clearMenuCell);

router.get('/textures', authenticateToken, listTextures);
router.post('/textures', authenticateToken, setupAdmin, requireClinicalActor, upsertTexture);
router.put('/textures/:id', authenticateToken, setupAdmin, requireClinicalActor, upsertTexture);

router.get('/supplements', authenticateToken, listSupplements);
router.post('/supplements', authenticateToken, setupAdmin, requireClinicalActor, upsertSupplement);
router.put('/supplements/:id', authenticateToken, setupAdmin, requireClinicalActor, upsertSupplement);

router.get('/settings', authenticateToken, getSettings);
router.put('/settings', authenticateToken, setupAdmin, requireClinicalActor, updateSettings);

router.get('/drug-food-interactions', authenticateToken, listDrugFoodInteractions);
router.get('/drug-food-interactions/admission/:admissionId', authenticateToken, getInteractionsForAdmission);

// ─── Diet plans (dietitian) ─────────────────────────────────────────
router.get('/queue', authenticateToken, getQueue);
router.get('/plans/admission/:admissionId/current', authenticateToken, getCurrentForAdmission);
router.get('/plans/admission/:admissionId/history', authenticateToken, getHistoryForAdmission);
router.post('/plans', authenticateToken, dietitian, requireClinicalActor, upsertDraft);
router.put('/plans/:id', authenticateToken, dietitian, requireClinicalActor, upsertDraft);
router.post('/plans/:id/sign', authenticateToken, dietitian, requireClinicalActor, signPlan);
router.post('/plans/:id/end', authenticateToken, dietitian, requireClinicalActor, endPlan);
router.get('/history/admission/:admissionId', authenticateToken, getDietHistory);

// ─── Diet Information Sheet ─────────────────────────────────────────
router.get('/sheet/preview', authenticateToken, getSheetPreview);
router.put('/sheet/cell', authenticateToken, dietitian, requireClinicalActor, updateCell);
router.post('/sheet/issue', authenticateToken, dietitian, requireClinicalActor, issueSheet);
router.get('/sheets', authenticateToken, listSheets);
router.get('/sheets/:id', authenticateToken, getSheet);
// F&B manager / supervisor only — the dietitian who issued it can't acknowledge their own sheet.
router.post('/sheets/:id/acknowledge', authenticateToken, fnbSupervisor, requireClinicalActor, acknowledgeSheet);

// ─── Meal holds (NPO / meal break) ──────────────────────────────────
router.get('/holds/admission/:admissionId', authenticateToken, listHolds);
router.post('/holds', authenticateToken, dietary, requireClinicalActor, createHold);
router.post('/holds/:id/lift', authenticateToken, dietary, requireClinicalActor, liftHold);

// ─── Nursing census → Dietary ───────────────────────────────────────
router.get('/census/wards', authenticateToken, listCensusWards);
router.get('/census/prefill', authenticateToken, nursing, getCensusPrefill);
router.post('/census', authenticateToken, nursing, requireClinicalActor, submitCensus);
router.get('/census', authenticateToken, listCensus);
router.get('/census/:id', authenticateToken, getCensus);
router.post('/census/:id/receive', authenticateToken, dietary, requireClinicalActor, receiveCensus);
router.post('/census/:id/acknowledge', authenticateToken, dietary, requireClinicalActor, acknowledgeCensus);

// ─── Clinical nutrition (screening forms, notes, rounds) ────────────
router.get('/rounds', authenticateToken, getRoundsList);
router.get('/nutrition/admission/:admissionId', authenticateToken, getNutritionForAdmission);
router.post('/nutrition/assessments', authenticateToken, dietitian, requireClinicalActor, createAssessment);
router.post('/nutrition/notes', authenticateToken, dietitian, requireClinicalActor, createNote);

// ─── Meal orders (kitchen + ward floor) ─────────────────────────────
router.get('/meal-orders/kitchen', authenticateToken, getKitchenList);
router.get('/meal-orders/admission/:admissionId', authenticateToken, getForAdmission);
router.post('/meal-orders/plate', authenticateToken, canteenFloor, requireClinicalActor, markPlated);
router.post('/meal-orders/:id/deliver', authenticateToken, canteenFloor, requireClinicalActor, markDelivered);
router.post('/meal-orders/:id/intake', authenticateToken, canteenFloor, requireClinicalActor, recordIntake);
router.post('/meal-orders/:id/skip', authenticateToken, canteenFloor, requireClinicalActor, skipMeal);
router.post('/meal-orders/regenerate', authenticateToken, orderSync, requireClinicalActor, regenerateForDate);
router.post('/meal-orders/bill', authenticateToken, billing, requireClinicalActor, markOrdersBilled);
router.get('/billing', authenticateToken, getBillingList);
router.get('/labels', authenticateToken, getLabels);

// ─── Extra food (patient extra / attendant / home-food patient) ─────
router.get('/extra-food', authenticateToken, listExtraFood);
router.post('/extra-food', authenticateToken, extraFood, requireClinicalActor, createExtraFood);
router.post('/extra-food/bill', authenticateToken, billing, requireClinicalActor, markExtraFoodBilled);
router.post('/extra-food/:id/:action', authenticateToken, canteenFloor, requireClinicalActor, updateExtraFood);

// ─── Dietary alerts ─────────────────────────────────────────────────
router.get('/alerts', authenticateToken, listAlerts);
router.post('/alerts/acknowledge', authenticateToken, dietary, requireClinicalActor, acknowledgeAlerts);

// ─── Canteen TV channels ────────────────────────────────────────────
router.get('/canteen-channels', authenticateToken, listCanteenChannels);
router.post('/canteen-channels', authenticateToken, setupAdmin, requireClinicalActor, upsertCanteenChannel);
router.put('/canteen-channels/:id', authenticateToken, setupAdmin, requireClinicalActor, upsertCanteenChannel);
// TV snapshot endpoint — unauthenticated so a kiosk browser can poll it.
router.get('/canteen-channels/:channelId/snapshot', getTvSnapshot);

export default router;
