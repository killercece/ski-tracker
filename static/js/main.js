/* Ski Tracker - JavaScript principal (Vanilla JS) */

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/**
 * Wrapper fetch avec gestion d'erreurs
 */
async function api(url, options) {
    try {
        var res = await fetch(url, options);
        if (!res.ok) {
            var body = await res.json().catch(function() { return {}; });
            throw new Error(body.error || 'Erreur ' + res.status);
        }
        return await res.json();
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    }
}

/**
 * Affiche un toast de notification
 */
function showToast(message, type) {
    type = type || 'success';
    var container = document.getElementById('toast-container');
    var toast = document.createElement('div');
    var bgClass = type === 'error'
        ? 'bg-red-600'
        : type === 'warning' ? 'bg-amber-600' : 'bg-primary-600';
    toast.className = 'toast-enter flex items-center gap-2 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg ' + bgClass;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(function() {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', function() { toast.remove(); });
    }, 3000);
}

/**
 * Formate les secondes en HH:MM ou HH:MM:SS
 */
function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return '--:--';
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    var s = Math.floor(seconds % 60);
    if (h > 0) {
        return h + 'h' + String(m).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
}

/**
 * Formate une date ISO en format lisible
 */
function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
        var d = new Date(dateStr);
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) {
        return dateStr;
    }
}

/**
 * Extrait l'heure d'une date ISO
 */
function formatTime(dateStr) {
    if (!dateStr) return '--:--';
    try {
        var d = new Date(dateStr);
        return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
        return '--:--';
    }
}

/**
 * Formate un nombre avec 1 decimale
 */
function fmt1(n) {
    if (n == null || isNaN(n)) return '--';
    return Number(n).toFixed(1);
}

/**
 * Formate un nombre sans decimale
 */
function fmt0(n) {
    if (n == null || isNaN(n)) return '--';
    return Math.round(Number(n)).toLocaleString('fr-FR');
}

// ---------------------------------------------------------------------------
// Theme sombre / clair
// ---------------------------------------------------------------------------

function toggleTheme() {
    var html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
}

// ---------------------------------------------------------------------------
// Sidebar mobile
// ---------------------------------------------------------------------------

function toggleSidebar() {
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('hidden');
}

// ---------------------------------------------------------------------------
// Dashboard : Stats globales
// ---------------------------------------------------------------------------

async function loadGlobalStats() {
    try {
        var data = await api('/api/stats');
        document.getElementById('stat-sessions').textContent = data.total_sessions || 0;
        document.getElementById('stat-distance').textContent = fmt1(data.total_distance);
        document.getElementById('stat-elevation').textContent = fmt0(data.total_elevation_gain);
        document.getElementById('stat-max-speed').textContent = fmt1(data.max_speed);
        document.getElementById('stat-descents').textContent = data.total_descents || 0;
    } catch (e) {
        // Toast deja affiche par api()
    }
}

// ---------------------------------------------------------------------------
// Dashboard : Liste des sessions
// ---------------------------------------------------------------------------

async function loadSessions() {
    var listEl = document.getElementById('sessions-list');
    var emptyEl = document.getElementById('sessions-empty');
    if (!listEl) return;

    try {
        var sessions = await api('/api/sessions');

        if (!sessions || sessions.length === 0) {
            listEl.innerHTML = '';
            emptyEl.classList.remove('hidden');
            return;
        }

        emptyEl.classList.add('hidden');
        listEl.innerHTML = sessions.map(function(s) {
            return '<div class="session-card rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 cursor-pointer" onclick="window.location.href=\'/session/' + s.id + '\'">' +
                '<div class="flex items-start justify-between gap-2">' +
                    '<div class="min-w-0">' +
                        '<h3 class="font-semibold truncate">' + escapeHtml(s.name) + '</h3>' +
                        '<p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">' + formatDate(s.date) + '</p>' +
                    '</div>' +
                    '<button onclick="event.stopPropagation(); openDeleteModal(' + s.id + ')" class="shrink-0 p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Supprimer">' +
                        '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>' +
                    '</button>' +
                '</div>' +
                '<div class="grid grid-cols-2 gap-3 mt-4 text-sm">' +
                    '<div><span class="text-zinc-500 dark:text-zinc-400">Distance</span><p class="font-semibold tabular-nums">' + fmt1(s.total_distance) + ' km</p></div>' +
                    '<div><span class="text-zinc-500 dark:text-zinc-400">Denivele</span><p class="font-semibold tabular-nums">' + fmt0(s.total_elevation_loss) + ' m</p></div>' +
                    '<div><span class="text-zinc-500 dark:text-zinc-400">Descentes</span><p class="font-semibold tabular-nums">' + (s.num_descents || 0) + '</p></div>' +
                    '<div><span class="text-zinc-500 dark:text-zinc-400">Vit. max</span><p class="font-semibold tabular-nums">' + fmt1(s.max_speed) + ' km/h</p></div>' +
                '</div>' +
            '</div>';
        }).join('');
    } catch (e) {
        // Toast deja affiche
    }
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Dashboard : Upload GPX
// ---------------------------------------------------------------------------

var selectedFile = null;

function initUpload() {
    var dropZone = document.getElementById('drop-zone');
    var fileInput = document.getElementById('file-input');
    if (!dropZone || !fileInput) return;

    // Drag & drop
    ['dragenter', 'dragover'].forEach(function(evt) {
        dropZone.addEventListener(evt, function(e) {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(function(evt) {
        dropZone.addEventListener(evt, function(e) {
            e.preventDefault();
            dropZone.classList.remove('dragover');
        });
    });

    dropZone.addEventListener('drop', function(e) {
        var files = e.dataTransfer.files;
        if (files.length > 0 && files[0].name.toLowerCase().endsWith('.gpx')) {
            selectFile(files[0]);
        } else {
            showToast('Veuillez deposer un fichier .gpx', 'warning');
        }
    });

    // Selection classique
    fileInput.addEventListener('change', function() {
        if (fileInput.files.length > 0) {
            selectFile(fileInput.files[0]);
        }
    });

    // Bouton clear
    var clearBtn = document.getElementById('file-clear');
    if (clearBtn) {
        clearBtn.addEventListener('click', clearFile);
    }
}

function selectFile(file) {
    selectedFile = file;
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('session-name-group').classList.remove('hidden');
    document.getElementById('upload-btn').classList.remove('hidden');
    document.getElementById('upload-btn').disabled = false;

    // Pre-remplir le nom de session avec le nom du fichier sans extension
    var name = file.name.replace(/\.gpx$/i, '').replace(/[_-]/g, ' ');
    document.getElementById('session-name').value = name;
}

function clearFile() {
    selectedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('session-name-group').classList.add('hidden');
    document.getElementById('upload-btn').classList.add('hidden');
    document.getElementById('upload-progress').classList.add('hidden');
}

async function uploadGPX() {
    if (!selectedFile) return;

    var uploadBtn = document.getElementById('upload-btn');
    var progressDiv = document.getElementById('upload-progress');
    var progressBar = document.getElementById('progress-bar');
    var progressPct = document.getElementById('progress-percent');

    uploadBtn.disabled = true;
    progressDiv.classList.remove('hidden');

    var formData = new FormData();
    formData.append('file', selectedFile);
    var sessionName = document.getElementById('session-name').value.trim();
    if (sessionName) {
        formData.append('name', sessionName);
    }

    // Upload avec suivi de progression
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.addEventListener('progress', function(e) {
        if (e.lengthComputable) {
            var pct = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = pct + '%';
            progressPct.textContent = pct + '%';
        }
    });

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            showToast('Session importee avec succes');
            clearFile();
            loadGlobalStats();
            loadSessions();
        } else {
            var err = 'Erreur lors de l\'import';
            try {
                var body = JSON.parse(xhr.responseText);
                if (body.error) err = body.error;
            } catch (e) {}
            showToast(err, 'error');
            uploadBtn.disabled = false;
        }
        progressDiv.classList.add('hidden');
        progressBar.style.width = '0%';
    };

    xhr.onerror = function() {
        showToast('Erreur reseau', 'error');
        uploadBtn.disabled = false;
        progressDiv.classList.add('hidden');
    };

    xhr.send(formData);
}

// ---------------------------------------------------------------------------
// Dashboard : Suppression de session
// ---------------------------------------------------------------------------

var deleteSessionId = null;

function openDeleteModal(id) {
    deleteSessionId = id;
    var modal = document.getElementById('delete-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    var confirmBtn = document.getElementById('confirm-delete-btn');
    confirmBtn.onclick = confirmDelete;
}

function closeDeleteModal() {
    var modal = document.getElementById('delete-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    deleteSessionId = null;
}

async function confirmDelete() {
    if (!deleteSessionId) return;
    try {
        await api('/api/sessions/' + deleteSessionId, { method: 'DELETE' });
        showToast('Session supprimee');
        closeDeleteModal();
        loadGlobalStats();
        loadSessions();
    } catch (e) {
        // Toast deja affiche
    }
}

// ---------------------------------------------------------------------------
// Session detail : Chargement des donnees
// ---------------------------------------------------------------------------

var sessionMap = null;
var trackLayers = {};

async function loadSessionDetail(sessionId) {
    try {
        // Charger les donnees en parallele
        var results = await Promise.all([
            api('/api/sessions/' + sessionId),
            api('/api/sessions/' + sessionId + '/tracks')
        ]);
        var sessionData = results[0];
        var tracksData = results[1];

        renderSessionStats(sessionData.session);
        // Aplatir la structure : [{track: {...}, points: [...]}] => [{...trackFields, points: [...]}]
        var flatTracks = tracksData.map(function(item) {
            var flat = Object.assign({}, item.track);
            flat.points = item.points;
            return flat;
        });
        renderMap(flatTracks);
        renderDescentsTable(flatTracks);
    } catch (e) {
        // Toast deja affiche
    }
}

function renderSessionStats(session) {
    setText('detail-distance', fmt1(session.total_distance));
    setText('detail-elev-gain', fmt0(session.total_elevation_gain));
    setText('detail-elev-loss', fmt0(session.total_elevation_loss));
    setText('detail-duration', formatDuration(session.duration_seconds));
    setText('detail-avg-speed', fmt1(session.avg_speed));
    setText('detail-max-speed', fmt1(session.max_speed));
    setText('detail-descents', session.num_descents || 0);
}

function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
}

// ---------------------------------------------------------------------------
// Session detail : Carte Leaflet
// ---------------------------------------------------------------------------

function renderMap(tracks) {
    var mapEl = document.getElementById('map');
    if (!mapEl || !tracks || tracks.length === 0) return;

    // Initialiser la carte
    sessionMap = L.map('map', {
        zoomControl: true,
        scrollWheelZoom: true
    });

    // Fond OpenStreetMap
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18
    }).addTo(sessionMap);

    var allBounds = [];
    var overlays = {
        'Descentes': L.layerGroup(),
        'Remontees': L.layerGroup(),
        'Pauses': L.layerGroup()
    };

    var colors = {
        descent: '#ef4444',
        lift: '#3b82f6',
        pause: '#9ca3af'
    };

    var labels = {
        descent: 'Descente',
        lift: 'Remontee',
        pause: 'Pause'
    };

    var layerNames = {
        descent: 'Descentes',
        lift: 'Remontees',
        pause: 'Pauses'
    };

    var descentCounter = 0;
    tracks.forEach(function(track, index) {
        if (track.segment_type === 'descent') {
            descentCounter++;
            track.descent_number = descentCounter;
        }
        if (!track.points || track.points.length < 2) return;

        var latlngs = track.points.map(function(p) {
            return [p.latitude, p.longitude];
        });

        var polyline = L.polyline(latlngs, {
            color: colors[track.segment_type] || '#9ca3af',
            weight: 4,
            opacity: 0.85
        });

        // Popup avec stats du segment
        var popupContent = '<div style="font-family: Inter, sans-serif; font-size: 13px; line-height: 1.5;">' +
            '<strong>' + (labels[track.segment_type] || track.segment_type) + '</strong>';
        if (track.segment_type === 'descent') {
            popupContent += ' #' + track.descent_number;
        }
        popupContent += '<br>' +
            'Distance : ' + fmt1(track.distance) + ' km<br>' +
            'Denivele : ' + fmt0(Math.abs(track.elevation_change)) + ' m<br>' +
            'Duree : ' + formatDuration(track.duration_seconds) + '<br>' +
            'Vit. moy : ' + fmt1(track.avg_speed) + ' km/h';
        if (track.segment_type === 'descent') {
            popupContent += '<br>Vit. max : ' + fmt1(track.max_speed) + ' km/h';
        }
        popupContent += '</div>';
        polyline.bindPopup(popupContent);

        // Stocker la reference pour le zoom depuis le tableau
        trackLayers[track.id] = polyline;

        var layerName = layerNames[track.segment_type];
        if (overlays[layerName]) {
            polyline.addTo(overlays[layerName]);
        }

        latlngs.forEach(function(ll) { allBounds.push(ll); });
    });

    // Ajouter les couches a la carte
    Object.keys(overlays).forEach(function(name) {
        overlays[name].addTo(sessionMap);
    });

    // Marqueurs depart et arrivee
    if (allBounds.length > 0) {
        // Premier point = depart
        var startIcon = L.divIcon({
            html: '<div style="width:14px;height:14px;background:#22c55e;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
            className: ''
        });
        L.marker(allBounds[0], { icon: startIcon, title: 'Depart' })
            .bindPopup('Depart')
            .addTo(sessionMap);

        // Dernier point = arrivee
        var endIcon = L.divIcon({
            html: '<div style="width:14px;height:14px;background:#ef4444;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.3);"></div>',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
            className: ''
        });
        L.marker(allBounds[allBounds.length - 1], { icon: endIcon, title: 'Arrivee' })
            .bindPopup('Arrivee')
            .addTo(sessionMap);

        // Fit bounds
        sessionMap.fitBounds(allBounds, { padding: [30, 30] });
    }

    // Controle de couches
    L.control.layers(null, overlays, { collapsed: false }).addTo(sessionMap);
}

// ---------------------------------------------------------------------------
// Session detail : Tableau des descentes
// ---------------------------------------------------------------------------

function renderDescentsTable(tracks) {
    var tbody = document.getElementById('descents-table');
    var emptyEl = document.getElementById('descents-empty');
    if (!tbody) return;

    var descents = tracks.filter(function(t) { return t.segment_type === 'descent'; });

    if (descents.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');

    tbody.innerHTML = descents.map(function(d, i) {
        return '<tr onclick="zoomToTrack(' + d.id + ')" class="hover:bg-zinc-50 dark:hover:bg-zinc-800/50">' +
            '<td class="px-4 py-3 font-medium">' + (i + 1) + '</td>' +
            '<td class="px-4 py-3 text-zinc-500 dark:text-zinc-400">' + formatTime(d.start_time) + '</td>' +
            '<td class="px-4 py-3">' + formatDuration(d.duration_seconds) + '</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(d.distance) + ' km</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt0(Math.abs(d.elevation_change)) + ' m</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(d.avg_speed) + ' km/h</td>' +
            '<td class="px-4 py-3 text-right tabular-nums">' + fmt1(d.max_speed) + ' km/h</td>' +
        '</tr>';
    }).join('');
}

function zoomToTrack(trackId) {
    var layer = trackLayers[trackId];
    if (layer && sessionMap) {
        sessionMap.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 16 });
        layer.openPopup();
    }
}
