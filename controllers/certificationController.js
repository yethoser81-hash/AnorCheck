const db = require('../config/database'); // Client Supabase
const AiBackendEngine = require('../engine/aiBackendEngine');
const SealRenderer = require('../engine/sealRenderer');
const crypto = require('crypto');
const worker = require('../worker'); // Importation du gestionnaire de file d'attente

const CertificationController = {

    // 1. Route d'aperçu simple
    generateSealPreview: async (req, res) => {
        try {
            console.log("👁️ [PREVIEW] Génération aperçu...");
            const body = req.body || {};
            const lot = body.lot || body.certificateCode || body.code_lot || 'PREVIEW-LOT';
            
            const smartPayload = AiBackendEngine.generateSmartMatrix(lot);
            const imageBuffer = await SealRenderer.renderSealToBuffer(smartPayload, { 
                lot,
                batchNumber: lot,
                productName: body.nom_produit || 'Aperçu'
            });

            const base64Image = imageBuffer 
                ? `data:image/png;base64,${imageBuffer.toString('base64').replace(/\r|\n/g, '')}` 
                : null;

            // 🟢 Télémétrie asynchrone : Génération d'aperçu
            worker.addJob(`telemetry_preview_${Date.now()}`, async (data) => {
                return await db.from('telemetry').insert([data]);
            }, {
                type: 'telemetry',
                payload: {
                    event: 'PREVIEW_GENERATED',
                    source: 'certification_controller',
                    metrics: { lot }
                }
            });

            return res.json({ success: true, imageUrl: base64Image });
        } catch (error) {
            console.error("❌ ERREUR PREVIEW :", error);

            // 🟢 Log Supabase asynchrone en cas d'erreur
            worker.addJob(`log_preview_err_${Date.now()}`, async (logData) => {
                return await db.from('app_logs').insert([logData]);
            }, {
                type: 'supabase_log',
                payload: {
                    level: 'error',
                    message: `Erreur aperçu sceau: ${error.message}`,
                    service: 'certification-service',
                    details: { stack: error.stack }
                }
            });

            return res.status(500).json({ error: error.message });
        }
    },

    // 2. Route /kit : Persistance complète dans Supabase
    generateSealKit: async (req, res) => {
        try {
            console.log("==================== DEBUT TRAITEMENT /kit ====================");
            const body = req.body || {};

            // A. Extraction & Formatage
            const lot = body.lot || body.certificateCode || body.code_lot || body.certificate_code;
            const nom_produit = body.nom_produit || body.productName || body.product_name || null;
            const nom_producteur = body.nom_producteur || body.producer || body.producer_name || null;
            const quantite = body.quantite ? parseInt(body.quantite, 10) : null;
            const type_emballage = body.type_emballage || body.packaging || body.packaging_type || null;
            const composition = body.composition || null;
            const pays_origine = body.pays_origine || body.origin || 'Cameroun';
            
            const date_certificat_conformite = body.date_certificat_conformite || body.date_certificat || null;
            const date_fabrication = body.date_fabrication || null;
            const date_peremption = body.date_peremption || null;

            if (!lot) {
                console.error("❌ [ERREUR] Numéro de lot introuvable dans req.body");
                return res.status(400).json({ error: "Le numéro de lot est obligatoire pour enregistrer les données." });
            }

            // B. Fichiers joints (PDF & Visuel)
            let certificat_pdf_url = body.certificat_pdf_url || body.certificat_pdf_path || null;
            let visuel_produit_url = body.visuel_produit_url || body.visuel_path || null;

            if (req.files) {
                if (req.files['certificat_pdf'] && req.files['certificat_pdf'][0]) {
                    const pdfFile = req.files['certificat_pdf'][0];
                    certificat_pdf_url = pdfFile.path || pdfFile.location || pdfFile.filename;
                }
                if (req.files['visuel_produit'] && req.files['visuel_produit'][0]) {
                    const visuelFile = req.files['visuel_produit'][0];
                    visuel_produit_url = visuelFile.path || visuelFile.location || visuelFile.filename;
                }
            }

            // C. Génération de la Matrice IA & Visuel
            const smartPayload = AiBackendEngine.generateSmartMatrix(lot);
            const imageBuffer = await SealRenderer.renderSealToBuffer(smartPayload, {
                lot,
                quantite,
                type_emballage,
                productName: nom_produit,
                nom_produit,
                nom_producteur
            });

            const rawBase64 = imageBuffer ? imageBuffer.toString('base64').replace(/\r|\n/g, '') : '';
            const base64Image = rawBase64 ? `data:image/png;base64,${rawBase64}` : null;

            // D. Cryptographie & Signature Sovereign
            const timestamp = new Date().toISOString();
            const rawDataString = `${lot}-${quantite || ''}-${type_emballage || ''}-${nom_produit || ''}-${timestamp}`;
            const sha256_hash = crypto.createHash('sha256').update(rawDataString).digest('hex');
            const signature_ia = smartPayload.aiSignature || sha256_hash;
            const engine_version = "ANOR-V16-SOVEREIGN";
            const statut = "CERTIFIÉ";

            // E. Objet Payload BDD Complet
            const payload = {
                certificate_code: lot,
                lot: lot,
                nom_produit: nom_produit,
                nom_producteur: nom_producteur,
                quantite: quantite,
                type_emballage: type_emballage,
                composition: composition,
                pays_origine: pays_origine,
                date_certificat_conformite: date_certificat_conformite,
                date_fabrication: date_fabrication,
                date_peremption: date_peremption,
                certificat_pdf_url: certificat_pdf_url,
                visuel_produit_url: visuel_produit_url,
                glyph_payload: smartPayload,
                ai_signature_hash: signature_ia,
                sha256_hash: sha256_hash,
                signature_ia: signature_ia,
                engine_version: engine_version,
                statut: statut
            };

            console.log(`--> TENTATIVE SAUVEGARDE SUPABASE POUR LE LOT : "${lot}"`);

            // F. Étape 1 : UPDATE si la ligne existe
            let { data: updatedData, error: updateError } = await db
                .from('produits_certifies')
                .update(payload)
                .eq('lot', lot)
                .select();

            if (updateError) {
                console.warn("⚠️ Attention lors du UPDATE Supabase :", updateError.message);
                
                // 🟢 Log d'avertissement en arrière-plan
                worker.addJob(`log_update_warn_${Date.now()}`, async (logData) => {
                    return await db.from('app_logs').insert([logData]);
                }, {
                    type: 'supabase_log',
                    payload: {
                        level: 'warn',
                        message: `Échec du UPDATE sur lot ${lot}, tentative d'insertion...`,
                        service: 'certification-service',
                        details: { error: updateError.message }
                    }
                });
            }

            let finalRecord = updatedData && updatedData.length > 0 ? updatedData[0] : null;

            // G. Étape 2 : INSERT si pas de ligne mise à jour
            if (!finalRecord) {
                console.log(`--> Lot "${lot}" absent. Insertion d'une nouvelle ligne...`);
                const { data: insertedData, error: insertError } = await db
                    .from('produits_certifies')
                    .insert([{ ...payload, scan_count: 0 }])
                    .select();

                if (insertError) {
                    console.error("❌ ERREUR CRITIQUE INSERT SUPABASE :", insertError);
                    
                    // 🟢 Log d'erreur critique asynchrone
                    worker.addJob(`log_insert_err_${Date.now()}`, async (logData) => {
                        return await db.from('app_logs').insert([logData]);
                    }, {
                        type: 'supabase_log',
                        payload: {
                            level: 'error',
                            message: `Erreur critique INSERT Supabase pour le lot ${lot}`,
                            service: 'certification-service',
                            details: { error: insertError.message }
                        }
                    });

                    return res.status(500).json({ 
                        error: "Impossible d'enregistrer les données dans Supabase.", 
                        details: insertError.message 
                    });
                }

                finalRecord = insertedData ? insertedData[0] : null;
            }

            console.log("✅ [SUPABASE SUCCESS] Enregistrement réussi :", finalRecord);

            // 🟢 Télémétrie : Forgement de kit réussi
            worker.addJob(`telemetry_kit_${lot}_${Date.now()}`, async (data) => {
                return await db.from('telemetry').insert([data]);
            }, {
                type: 'telemetry',
                payload: {
                    event: 'KIT_SEAL_GENERATED',
                    source: 'certification_controller',
                    metrics: { lot, nom_produit, quantite },
                    context: { engine_version }
                }
            });

            return res.json({
                success: true,
                status: "SUCCÈS",
                message: "Kit forgé et certifié avec succès",
                lot: lot,
                imageUrl: base64Image,
                sha256_hash: sha256_hash,
                record: finalRecord
            });

        } catch (error) {
            console.error("❌ ERREUR CRITIQUE SERVEUR /kit :", error);

            // 🟢 Log d'erreur serveur globale
            worker.addJob(`log_kit_crit_${Date.now()}`, async (logData) => {
                return await db.from('app_logs').insert([logData]);
            }, {
                type: 'supabase_log',
                payload: {
                    level: 'error',
                    message: `Erreur critique /kit: ${error.message}`,
                    service: 'certification-service',
                    details: { stack: error.stack }
                }
            });

            return res.status(500).json({ error: error.message });
        }
    },

    // 3. Route de vérification d'un produit certifié
    verifySeal: async (req, res) => {
        try {
            const { lot, scannedMatrix } = req.body;
            if (!lot) {
                return res.status(400).json({ error: "Numéro de lot requis pour la vérification." });
            }

            const { data: row, error } = await db
                .from('produits_certifies')
                .select('*')
                .eq('lot', lot)
                .single();

            if (error || !row) {
                // 🟢 Télémétrie : Tentative de scan sur un lot introuvable
                worker.addJob(`telemetry_verify_unknown_${Date.now()}`, async (data) => {
                    return await db.from('telemetry').insert([data]);
                }, {
                    type: 'telemetry',
                    payload: {
                        event: 'VERIFY_UNKNOWN_LOT',
                        source: 'verification_service',
                        metrics: { lot }
                    }
                });

                return res.status(404).json({ valid: false, message: "Produit ou lot non certifié." });
            }

            // Si une matrice est transmise pour vérification d'empreinte
            if (scannedMatrix && row.glyph_payload) {
                const evaluation = AiBackendEngine.evaluateScanConfidence(scannedMatrix, row.glyph_payload.matrix);
                if (!evaluation.isValid) {

                    // 🟢 Log & Télémétrie : Contrefaçon détectée
                    worker.addJob(`telemetry_counterfeit_${lot}_${Date.now()}`, async (data) => {
                        return await db.from('telemetry').insert([data]);
                    }, {
                        type: 'telemetry',
                        payload: {
                            event: 'COUNTERFEIT_DETECTED',
                            source: 'verification_service',
                            metrics: { lot, confidence: evaluation.confidence }
                        }
                    });

                    return res.status(401).json({
                        valid: false,
                        status: "CONTREFAÇON_DETECTEE",
                        message: "Incohérence détectée sur la matrice géométrique du sceau.",
                        confidence: evaluation.confidence
                    });
                }
            }

            // 🟢 Télémétrie : Vérification réussie
            worker.addJob(`telemetry_verify_success_${lot}_${Date.now()}`, async (data) => {
                return await db.from('telemetry').insert([data]);
            }, {
                type: 'telemetry',
                payload: {
                    event: 'VERIFY_SUCCESS',
                    source: 'verification_service',
                    metrics: { lot }
                }
            });

            return res.json({ valid: true, product: row });
        } catch (error) {
            console.error("❌ ERREUR VERIFY :", error);

            worker.addJob(`log_verify_err_${Date.now()}`, async (logData) => {
                return await db.from('app_logs').insert([logData]);
            }, {
                type: 'supabase_log',
                payload: {
                    level: 'error',
                    message: `Erreur durant la vérification: ${error.message}`,
                    service: 'verification-service',
                    details: { stack: error.stack }
                }
            });

            return res.status(500).json({ error: error.message });
        }
    }
};

module.exports = CertificationController;