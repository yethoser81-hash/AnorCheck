const path = require('path');
const fs = require('fs');

console.log("--- DIAGNOSTIC DES CHEMINS ---");

// 1. Où le script s'exécute-t-il ?
console.log("Dossier d'exécution actuel (CWD) :", process.cwd());

// 2. Le chemin qu'on tente d'utiliser
const cheminRelatif = 'backend/assets/logo_anor_master.png';
console.log("Chemin relatif tenté :", cheminRelatif);

// 3. Construction du chemin absolu
const cheminAbsolu = path.resolve(process.cwd(), cheminRelatif);
console.log("Chemin absolu reconstruit :", cheminAbsolu);

// 4. VERIFICATION PHYSIQUE
console.log("--- VERIFICATION ---");
if (fs.existsSync(cheminAbsolu)) {
    console.log("✅ SUCCÈS : Le fichier existe physiquement à cet emplacement.");
    const stats = fs.statSync(cheminAbsolu);
    console.log(`Taille du fichier : ${stats.size} octets`);
} else {
    console.log("❌ ÉCHEC : Le fichier est INTROUVABLE à cet emplacement.");
    console.log("Vérifie l'orthographe exacte et la structure de tes dossiers.");
}