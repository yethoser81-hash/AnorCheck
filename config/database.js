const { createClient } = require('@supabase/supabase-js');
const path = require('path');

// Chargement explicite en ciblant directement le fichier .env à la racine du backend
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Debug temporaire pour vérifier ce que Node.js lit réellement dans le terminal
console.log("DEBUG SUPABASE_URL:", supabaseUrl ? "Présent" : "MANQUANT");
console.log("DEBUG SUPABASE_KEY:", supabaseKey ? "Présent" : "MANQUANT");

if (!supabaseUrl || !supabaseKey) {
    throw new Error("Erreur critique : Les identifiants Supabase sont absents du fichier .env");
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;