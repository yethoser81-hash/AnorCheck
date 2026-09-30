// worker.js - Gestionnaire de file d'attente contrôlé pour ANOR-CHECK

/**
 * Normalise la structure des payloads de télémétrie et de logs
 * pour garantir un format uniforme en base / Supabase.
 */
function normalizePayload(type, payload = {}) {
    const timestamp = new Date().toISOString();

    switch (type) {
        case 'telemetry':
            return {
                timestamp,
                event: payload.event || 'UNKNOWN_EVENT',
                source: payload.source || 'app_worker',
                metrics: payload.metrics || {},
                context: payload.context || {}
            };

        case 'supabase_log':
            return {
                timestamp,
                level: (payload.level || 'info').toLowerCase(),
                message: payload.message || '',
                details: payload.details || null,
                service: payload.service || 'anor-check-service'
            };

        default:
            return {
                timestamp,
                type,
                raw: payload
            };
    }
}

class TaskQueue {
    constructor(ttlMinutes = 30) {
        this.jobs = new Map();
        this.statusCache = new Map(); // Indexation rapide pour /status/:jobId
        this.queue = [];              // File d'attente prioritaire
        
        this.ttlMs = ttlMinutes * 60 * 1000;
        this.activeJobs = 0;
        this.maxConcurrentJobs = 5;  // Limite de concurrence
        this.maxStoredJobs = 5000;    // Seuil de protection mémoire RAM

        this.priority = {
            critical: 1, // Génération de batch / PDF / ZIP
            normal: 5,   // Télémétrie / Apprentissage différé
            low: 10      // Logs / Statistiques
        };
        
        // Nettoyage périodique des vieux jobs
        setInterval(() => this._cleanUpOldJobs(), 10 * 60 * 1000);
    }

    /**
     * Enregistre une tâche dans la file d'attente prioritaire.
     * 
     * @param {string} jobId - Identifiant unique de la tâche.
     * @param {Function} taskFunction - Fonction asynchrone à exécuter.
     * @param {Object} options - Type de tâche, payload et priorité.
     */
    addJob(jobId, taskFunction, options = { type: 'generic', payload: {}, priority: 'normal' }) {
        const priorityLevel = this.priority[options.priority] || (options.type === 'generation_batch' ? this.priority.critical : this.priority.normal);

        // Inscription dans le cache de statut rapide
        this.statusCache.set(jobId, 'queued');

        // Métadonnées initiales du job
        this.jobs.set(jobId, {
            jobId,
            type: options.type,
            status: 'queued',
            payload: options.payload,
            result: null,
            error: null,
            createdAt: new Date()
        });

        // Empilage dans la file d'attente
        this.queue.push({
            jobId,
            taskFunction,
            options,
            priority: priorityLevel
        });

        // Tri explicite de la file : les priorités les plus basses (ex: 1) passent en premier
        this.queue.sort((a, b) => a.priority - b.priority);

        // Déclenchement du moteur d'exécution
        this.processQueue();
    }

    /**
     * Moteur de traitement contrôlé de la file d'attente.
     */
    async processQueue() {
        if (this.activeJobs >= this.maxConcurrentJobs) {
            return;
        }

        const job = this.queue.shift();
        if (!job) {
            return;
        }

        this.activeJobs++;

        try {
            await this.executeJob(job);
        } finally {
            this.activeJobs--;
            this.processQueue(); // Traitement récursif de la tâche suivante
        }
    }

    /**
     * Exécute la tâche individuelle isolée.
     */
    async executeJob(job) {
        const { jobId, taskFunction, options } = job;

        this.statusCache.set(jobId, 'processing');
        
        const currentJobData = this.jobs.get(jobId);
        if (currentJobData) {
            currentJobData.status = 'processing';
            currentJobData.startedAt = new Date();
        }

        try {
            const normalizedData = normalizePayload(options.type, options.payload);
            const result = await taskFunction(normalizedData);

            this.statusCache.set(jobId, 'completed');
            this.jobs.set(jobId, {
                ...this.jobs.get(jobId),
                status: 'completed',
                result: result || null,
                completedAt: new Date()
            });

            console.log(`✅ [WORKER] Tâche [${options.type}] ${jobId} terminée avec succès.`);
        } catch (err) {
            console.error(`❌ [WORKER] Échec de la tâche [${options.type}] ${jobId}:`, err.message);

            this.statusCache.set(jobId, 'failed');
            this.jobs.set(jobId, {
                ...this.jobs.get(jobId),
                status: 'failed',
                error: {
                    message: err.message,
                    stack: err.stack || null
                },
                failedAt: new Date()
            });
        }
    }

    /**
     * Récupère l'état courant d'une tâche (Optimisé via statusCache).
     */
    getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return null;

        return {
            ...job,
            quickStatus: this.statusCache.get(jobId) || job.status
        };
    }

    /**
     * Nettoie les tâches anciennes ou excédentaires pour protéger la mémoire.
     */
    _cleanUpOldJobs() {
        const now = Date.now();

        // 1. Purge par TTL (Délai d'expiration)
        for (const [jobId, job] of this.jobs.entries()) {
            const finishedTime = job.completedAt || job.failedAt;
            if (finishedTime && (now - new Date(finishedTime).getTime() > this.ttlMs)) {
                this.jobs.delete(jobId);
                this.statusCache.delete(jobId);
            }
        }

        // 2. Purge par Taille Maximale (Sécurité anti-débordement RAM)
        if (this.jobs.size > this.maxStoredJobs) {
            const keysToDeleteCount = this.jobs.size - this.maxStoredJobs;
            const iterator = this.jobs.keys();

            for (let i = 0; i < keysToDeleteCount; i++) {
                const oldestKey = iterator.next().value;
                if (oldestKey) {
                    this.jobs.delete(oldestKey);
                    this.statusCache.delete(oldestKey);
                }
            }
            console.warn(`🧹 [WORKER MEMORY] Purge de sécurité : ${keysToDeleteCount} anciens jobs retirés de la mémoire.`);
        }
    }
}

module.exports = new TaskQueue();