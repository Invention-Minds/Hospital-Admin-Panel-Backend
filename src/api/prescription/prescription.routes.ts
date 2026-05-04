// src/routes/prescriptionRoutes.ts
import express from 'express';
import { createPrescription, saveFavoriteTablet, getFavoritesByUser, removeFavoriteTablet, getTabletById, getAllTablets, createTablet, getAllFavorites, addAllergies, getAllergiesByPrn, deleteAllergy, getPrescriptionByPrn } from './prescription.controller';
import { authenticateToken } from '../../middleware/middleware';

const router = express.Router();

router.post('/',authenticateToken, createPrescription);
router.post('/favorites',authenticateToken, saveFavoriteTablet);
router.get('/favorites', authenticateToken,getAllFavorites);
router.get('/favorites/:userId',authenticateToken, getFavoritesByUser);
router.delete('/favorites/:id',authenticateToken, removeFavoriteTablet);
router.get('/tablets/:id',authenticateToken, getTabletById);
router.post('/tablets', authenticateToken, createTablet); // Sprint 4b.2 — TabletMaster.createdBy now server-derived
router.get('/tablets',authenticateToken, getAllTablets);
router.post('/allergies',authenticateToken, addAllergies);
router.get('/allergies/:prn',authenticateToken, getAllergiesByPrn);
router.delete('/allergies/:id',authenticateToken, deleteAllergy);
router.get('/:prn', authenticateToken, getPrescriptionByPrn);



export default router;
