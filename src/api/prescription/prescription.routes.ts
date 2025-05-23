// src/routes/prescriptionRoutes.ts
import express from 'express';
import { createPrescription, saveFavoriteTablet, getFavoritesByUser, removeFavoriteTablet, getTabletById, getAllTablets, createTablet, getAllFavorites, addAllergies, getAllergiesByPrn, deleteAllergy, getPrescriptionByPrn } from './prescription.controller';

const router = express.Router();

router.post('/', createPrescription);
router.post('/favorites', saveFavoriteTablet);
router.get('/favorites', getAllFavorites);
router.get('/favorites/:userId', getFavoritesByUser);
router.delete('/favorites/:id', removeFavoriteTablet);
router.get('/tablets/:id', getTabletById);
router.post('/tablets', createTablet);
router.get('/tablets', getAllTablets);
router.post('/allergies', addAllergies);
router.get('/allergies/:prn', getAllergiesByPrn);
router.delete('/allergies/:id', deleteAllergy);
router.get('/:prn', getPrescriptionByPrn);



export default router;
