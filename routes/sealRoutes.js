const express = require('express');
const router = express.Router();
const CertificationController = require('../controllers/certificationController');

// Route pour afficher l'image PNG dans l'interface (Aperçu)
router.post('/generate', CertificationController.generateSealPreview);

// Route pour télécharger le Kit ZIP complet et enregistrer en base
router.post('/kit', CertificationController.generateSealKit);

// Route de vérification
router.post('/verify', CertificationController.verifySeal);

module.exports = router;