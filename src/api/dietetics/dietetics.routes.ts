import express from 'express';
import { authenticateToken } from '../../middleware/middleware';
import { requireClinicalActor } from '../../middleware/audit-guard';

import {
  listMealTimeSlots, upsertMealTimeSlot,
  listAllergens, upsertAllergen,
  listDiets, upsertDiet,
  listMeals, upsertMeal,
  getMenuForDiet, upsertMenuCell, clearMenuCell,
  listDrugFoodInteractions, getInteractionsForAdmission,
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
} from './meal-order.controller';

const router = express.Router();

// ─── Masters — diets, meals, allergens, slots, menus, drug-food ─────
// Reads: any authenticated user (dieticians, doctors, nurses all need them).
// Writes: super_admin gating happens in the frontend; we attach
// requireClinicalActor here only for audit-actor capture.
router.get('/meal-time-slots', authenticateToken, listMealTimeSlots);
router.post('/meal-time-slots', authenticateToken, requireClinicalActor, upsertMealTimeSlot);
router.put('/meal-time-slots/:id', authenticateToken, requireClinicalActor, upsertMealTimeSlot);

router.get('/allergens', authenticateToken, listAllergens);
router.post('/allergens', authenticateToken, requireClinicalActor, upsertAllergen);
router.put('/allergens/:id', authenticateToken, requireClinicalActor, upsertAllergen);

router.get('/diets', authenticateToken, listDiets);
router.post('/diets', authenticateToken, requireClinicalActor, upsertDiet);
router.put('/diets/:id', authenticateToken, requireClinicalActor, upsertDiet);

router.get('/meals', authenticateToken, listMeals);
router.post('/meals', authenticateToken, requireClinicalActor, upsertMeal);
router.put('/meals/:id', authenticateToken, requireClinicalActor, upsertMeal);

router.get('/menu/:dietMasterId', authenticateToken, getMenuForDiet);
router.post('/menu', authenticateToken, requireClinicalActor, upsertMenuCell);
router.delete('/menu/:dietMasterId/:mealTimeSlotId/:dayOfWeek', authenticateToken, requireClinicalActor, clearMenuCell);

router.get('/drug-food-interactions', authenticateToken, listDrugFoodInteractions);
router.get('/drug-food-interactions/admission/:admissionId', authenticateToken, getInteractionsForAdmission);

// ─── Diet plans ─────────────────────────────────────────────────────
router.get('/queue', authenticateToken, getQueue);
router.get('/plans/admission/:admissionId/current', authenticateToken, getCurrentForAdmission);
router.get('/plans/admission/:admissionId/history', authenticateToken, getHistoryForAdmission);
router.post('/plans', authenticateToken, requireClinicalActor, upsertDraft);
router.put('/plans/:id', authenticateToken, requireClinicalActor, upsertDraft);
router.post('/plans/:id/sign', authenticateToken, requireClinicalActor, signPlan);
router.post('/plans/:id/end', authenticateToken, requireClinicalActor, endPlan);

// ─── Meal orders (canteen + ward floor) ─────────────────────────────
router.get('/meal-orders/kitchen', authenticateToken, getKitchenList);
router.get('/meal-orders/admission/:admissionId', authenticateToken, getForAdmission);
router.post('/meal-orders/plate', authenticateToken, requireClinicalActor, markPlated);
router.post('/meal-orders/:id/deliver', authenticateToken, requireClinicalActor, markDelivered);
router.post('/meal-orders/:id/intake', authenticateToken, requireClinicalActor, recordIntake);
router.post('/meal-orders/:id/skip', authenticateToken, requireClinicalActor, skipMeal);
router.post('/meal-orders/regenerate', authenticateToken, requireClinicalActor, regenerateForDate);

// ─── Canteen TV channels ────────────────────────────────────────────
router.get('/canteen-channels', authenticateToken, listCanteenChannels);
router.post('/canteen-channels', authenticateToken, requireClinicalActor, upsertCanteenChannel);
router.put('/canteen-channels/:id', authenticateToken, requireClinicalActor, upsertCanteenChannel);
// TV snapshot endpoint — unauthenticated so a kiosk browser can poll it.
router.get('/canteen-channels/:channelId/snapshot', getTvSnapshot);

export default router;
