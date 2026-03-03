"""
Ski Tracker — Application Flask pour le suivi de sessions de ski.
Upload de fichiers GPX, détection automatique des descentes/remontées,
statistiques et visualisation sur carte.
"""

__version__ = '1.4.2'

import os
import logging
import sqlite3
from collections import defaultdict
from datetime import datetime
from functools import wraps
from math import radians, cos, sin, asin, sqrt
from pathlib import Path

import json
import requests

import gpxpy
from flask import Flask, g, request, jsonify, render_template, session, redirect, url_for
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'dev-secret-key-change-me')
app.config['DATABASE_PATH'] = os.environ.get('DATABASE_PATH', 'data/ski-tracker.db')
app.config['UPLOAD_FOLDER'] = os.environ.get('UPLOAD_FOLDER', 'data/uploads')
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', 52428800))

# ---------------------------------------------------------------------------
# Base de données
# ---------------------------------------------------------------------------


def get_db():
    """Retourne une connexion SQLite stockée dans g."""
    if 'db' not in g:
        g.db = sqlite3.connect(app.config['DATABASE_PATH'])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(e=None):
    """Ferme la connexion SQLite en fin de requête."""
    db = g.pop('db', None)
    if db is not None:
        db.close()


app.teardown_appcontext(close_db)


def init_db():
    """Crée les tables manquantes au démarrage de l'application."""
    db_path = app.config['DATABASE_PATH']
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            date TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id),
            total_distance REAL DEFAULT 0,
            total_elevation_gain REAL DEFAULT 0,
            total_elevation_loss REAL DEFAULT 0,
            max_speed REAL DEFAULT 0,
            avg_speed REAL DEFAULT 0,
            num_descents INTEGER DEFAULT 0,
            duration_seconds INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            segment_type TEXT NOT NULL CHECK(segment_type IN ('descent', 'lift', 'pause')),
            start_time TEXT, end_time TEXT,
            distance REAL DEFAULT 0, elevation_change REAL DEFAULT 0,
            avg_speed REAL DEFAULT 0, max_speed REAL DEFAULT 0,
            duration_seconds INTEGER DEFAULT 0,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS track_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER NOT NULL,
            latitude REAL NOT NULL, longitude REAL NOT NULL,
            elevation REAL, time TEXT, speed REAL,
            point_order INTEGER NOT NULL,
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_tracks_session ON tracks(session_id);
        CREATE INDEX IF NOT EXISTS idx_points_track ON track_points(track_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);

        CREATE TABLE IF NOT EXISTS osm_pistes (
            osm_id INTEGER PRIMARY KEY,
            name TEXT,
            difficulty TEXT,
            geometry TEXT,
            bbox_min_lat REAL, bbox_max_lat REAL,
            bbox_min_lon REAL, bbox_max_lon REAL,
            fetched_at TEXT
        );
        CREATE TABLE IF NOT EXISTS osm_fetch_zones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            min_lat REAL, max_lat REAL,
            min_lon REAL, max_lon REAL,
            fetched_at TEXT
        );
    """)
    # Migration : ajouter user_id si manquant
    cols = [r[1] for r in conn.execute("PRAGMA table_info(sessions)").fetchall()]
    if 'user_id' not in cols:
        conn.execute("ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id)")
        logger.info("Migration : colonne user_id ajoutée")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
    # Migration : colonnes piste matching sur tracks
    track_cols = [r[1] for r in conn.execute("PRAGMA table_info(tracks)").fetchall()]
    if 'piste_osm_id' not in track_cols:
        conn.execute("ALTER TABLE tracks ADD COLUMN piste_osm_id INTEGER")
        conn.execute("ALTER TABLE tracks ADD COLUMN piste_name TEXT")
        conn.execute("ALTER TABLE tracks ADD COLUMN piste_difficulty TEXT")
        conn.execute("ALTER TABLE tracks ADD COLUMN match_confidence REAL")
        logger.info("Migration : colonnes piste matching ajoutées à tracks")
    # v1.4.2 : purger cache OSM et matchs pour re-fetch avec relations + name:fr
    osm_version = conn.execute(
        "SELECT fetched_at FROM osm_fetch_zones ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if osm_version and osm_version[0] < '2026-03-05':
        conn.execute("DELETE FROM osm_pistes")
        conn.execute("DELETE FROM osm_fetch_zones")
        conn.execute("UPDATE tracks SET piste_osm_id=NULL, piste_name=NULL, piste_difficulty=NULL, match_confidence=NULL")
        logger.info("Migration v1.4.2 : cache OSM purgé pour re-fetch avec relations")
    conn.commit()
    conn.close()
    logger.info("Base de données vérifiée")


init_db()


def login_required(f):
    """Décorateur pour protéger les routes nécessitant une authentification."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({'error': 'Authentification requise'}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


@app.context_processor
def inject_globals():
    """Injecte les variables globales dans tous les templates."""
    user = None
    if 'user_id' in session:
        db = get_db()
        user = db.execute("SELECT id, username FROM users WHERE id = ?", (session['user_id'],)).fetchone()
        if user:
            user = dict(user)
    return {'version': __version__, 'user': user}

# ---------------------------------------------------------------------------
# Routes — Authentification
# ---------------------------------------------------------------------------


@app.route('/login')
def login_page():
    """Page de connexion."""
    if 'user_id' in session:
        return redirect(url_for('index'))
    return render_template('login.html')


@app.route('/register')
def register_page():
    """Page d'inscription."""
    if 'user_id' in session:
        return redirect(url_for('index'))
    return render_template('register.html')


@app.route('/api/register', methods=['POST'])
def api_register():
    """Inscription d'un nouvel utilisateur."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Données manquantes'}), 400

    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    if not username or len(username) < 3:
        return jsonify({'error': 'Le nom d\'utilisateur doit faire au moins 3 caractères'}), 400
    if len(password) < 6:
        return jsonify({'error': 'Le mot de passe doit faire au moins 6 caractères'}), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if existing:
        return jsonify({'error': 'Ce nom d\'utilisateur est déjà pris'}), 409

    password_hash = generate_password_hash(password)
    cursor = db.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, password_hash))
    db.commit()

    session['user_id'] = cursor.lastrowid
    logger.info("Nouvel utilisateur inscrit : %s (id=%d)", username, cursor.lastrowid)

    return jsonify({'message': 'Inscription réussie', 'username': username}), 201


@app.route('/api/login', methods=['POST'])
def api_login():
    """Connexion d'un utilisateur."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'Données manquantes'}), 400

    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    if not username or not password:
        return jsonify({'error': 'Nom d\'utilisateur et mot de passe requis'}), 400

    db = get_db()
    user = db.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,)).fetchone()

    if not user or not check_password_hash(user['password_hash'], password):
        return jsonify({'error': 'Identifiants incorrects'}), 401

    session['user_id'] = user['id']
    logger.info("Connexion : %s (id=%d)", username, user['id'])

    return jsonify({'message': 'Connexion réussie', 'username': user['username']})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    """Déconnexion."""
    session.clear()
    return jsonify({'message': 'Déconnexion réussie'})


# ---------------------------------------------------------------------------
# Utilitaires GPS
# ---------------------------------------------------------------------------


def haversine(lat1, lon1, lat2, lon2):
    """Calcule la distance en mètres entre deux points GPS (formule de Haversine)."""
    R = 6371000
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return R * 2 * asin(sqrt(a))


def repair_gpx(content):
    """Répare un fichier GPX tronqué en ajoutant les balises fermantes manquantes."""
    content = content.rstrip()
    closing_tags = ['</trkpt>', '</trkseg>', '</trk>', '</rte>', '</gpx>']
    for tag in closing_tags:
        if tag in content and not content.endswith(tag.replace('</', '</').replace('>', '')):
            pass
    # Vérifier et ajouter les balises fermantes manquantes
    if '</gpx>' not in content:
        if '</trkseg>' not in content.split('</trkpt>')[-1] if '</trkpt>' in content else True:
            content += '\n    </trkseg>'
        if '</trk>' not in content.split('</trkseg>')[-1] if '</trkseg>' in content else True:
            content += '\n  </trk>'
        content += '\n</gpx>'
        logger.info("Fichier GPX tronqué réparé (balises fermantes ajoutées)")
    return content


def parse_gpx(file_content):
    """Parse un fichier GPX et retourne la liste des points (tracks, routes, waypoints)."""
    file_content = repair_gpx(file_content)
    gpx = gpxpy.parse(file_content)
    points = []
    # Points de tracks (cas principal)
    for track in gpx.tracks:
        for segment in track.segments:
            for point in segment.points:
                points.append({
                    'latitude': point.latitude,
                    'longitude': point.longitude,
                    'elevation': point.elevation,
                    'time': point.time.isoformat() if point.time else None
                })
    # Fallback : points de routes
    if not points:
        for route in gpx.routes:
            for point in route.points:
                points.append({
                    'latitude': point.latitude,
                    'longitude': point.longitude,
                    'elevation': point.elevation,
                    'time': point.time.isoformat() if point.time else None
                })
    # Fallback : waypoints isolés
    if not points:
        for point in gpx.waypoints:
            points.append({
                'latitude': point.latitude,
                'longitude': point.longitude,
                'elevation': point.elevation,
                'time': point.time.isoformat() if point.time else None
            })
    return points


def smooth_values(values, window=5):
    """Lisse une liste de valeurs avec une moyenne mobile."""
    smoothed = []
    half = window // 2
    for i in range(len(values)):
        start = max(0, i - half)
        end = min(len(values), i + half + 1)
        smoothed.append(sum(values[start:end]) / (end - start))
    return smoothed


def compute_point_metrics(points):
    """Calcule vitesse (km/h) et variation d'altitude entre chaque paire de points."""
    speeds = [0.0]
    elevation_deltas = [0.0]

    for i in range(1, len(points)):
        prev, curr = points[i - 1], points[i]
        dist = haversine(prev['latitude'], prev['longitude'],
                         curr['latitude'], curr['longitude'])

        dt = 0.0
        if prev['time'] and curr['time']:
            t1 = datetime.fromisoformat(prev['time'])
            t2 = datetime.fromisoformat(curr['time'])
            dt = (t2 - t1).total_seconds()

        speed = (dist / dt * 3.6) if dt > 0 else 0.0
        # Filtrer le bruit GPS : vitesse max réaliste pour le ski = 150 km/h
        if speed > 150.0:
            speed = 0.0
        elev_delta = (curr['elevation'] or 0) - (prev['elevation'] or 0)

        speeds.append(speed)
        elevation_deltas.append(elev_delta)

    return speeds, elevation_deltas


def classify_point(speed, elev_delta):
    """Classifie un point individuel en phase."""
    if speed < 3.0:
        return 'pause'
    if elev_delta < 0 and speed > 5.0:
        return 'descent'
    if elev_delta > 0 and speed < 15.0:
        return 'lift'
    # Zone ambiguë : privilégier descente si rapide
    if speed > 15.0:
        return 'descent'
    return 'lift'


def detect_segments(points):
    """
    Détecte les segments de type : descent, lift, pause.

    Utilise un algorithme à fenêtre glissante :
    1. Calcule vitesse et variation d'altitude entre chaque point
    2. Lisse les données (moyenne mobile sur 5 points)
    3. Détecte les changements de phase
    4. Crée des segments avec stats

    Retourne une liste de segments avec type, points, et statistiques.
    """
    if len(points) < 2:
        return []

    speeds, elevation_deltas = compute_point_metrics(points)

    # Lissage
    smoothed_speeds = smooth_values(speeds, window=5)
    smoothed_elev = smooth_values(elevation_deltas, window=5)

    # Classification par point
    classifications = []
    for i in range(len(points)):
        classifications.append(classify_point(smoothed_speeds[i], smoothed_elev[i]))

    # Construction des segments
    segments = []
    seg_start = 0
    current_type = classifications[0]

    for i in range(1, len(classifications)):
        if classifications[i] != current_type:
            segments.append(_build_segment(
                points[seg_start:i + 1], current_type, speeds[seg_start:i + 1]
            ))
            seg_start = i
            current_type = classifications[i]

    # Dernier segment
    segments.append(_build_segment(
        points[seg_start:], current_type, speeds[seg_start:]
    ))

    # Filtrer les segments trop courts (< 3 points) et les fusionner
    segments = _merge_short_segments(segments)

    # Valider les segments selon les seuils d'altitude
    segments = _validate_segments(segments)

    return segments


def _build_segment(seg_points, seg_type, seg_speeds):
    """Construit un segment avec ses statistiques."""
    total_dist = 0.0
    for i in range(1, len(seg_points)):
        total_dist += haversine(
            seg_points[i - 1]['latitude'], seg_points[i - 1]['longitude'],
            seg_points[i]['latitude'], seg_points[i]['longitude']
        )

    elev_start = seg_points[0].get('elevation') or 0
    elev_end = seg_points[-1].get('elevation') or 0
    elev_change = elev_end - elev_start

    duration = 0
    if seg_points[0]['time'] and seg_points[-1]['time']:
        t1 = datetime.fromisoformat(seg_points[0]['time'])
        t2 = datetime.fromisoformat(seg_points[-1]['time'])
        duration = int((t2 - t1).total_seconds())

    valid_speeds = [s for s in seg_speeds if s > 0]
    avg_speed = sum(valid_speeds) / len(valid_speeds) if valid_speeds else 0.0
    max_speed = max(seg_speeds) if seg_speeds else 0.0

    return {
        'type': seg_type,
        'points': seg_points,
        'distance': round(total_dist / 1000, 2),
        'elevation_change': round(elev_change, 2),
        'duration_seconds': duration,
        'avg_speed': round(avg_speed, 2),
        'max_speed': round(max_speed, 2),
        'start_time': seg_points[0]['time'],
        'end_time': seg_points[-1]['time'],
    }


def _merge_short_segments(segments, min_points=3):
    """Fusionne les segments trop courts avec le segment précédent."""
    if not segments:
        return segments

    merged = [segments[0]]
    for seg in segments[1:]:
        if len(seg['points']) < min_points:
            # Fusionner avec le précédent
            prev = merged[-1]
            combined_points = prev['points'] + seg['points'][1:]
            combined_speeds = []
            for i in range(1, len(combined_points)):
                p1, p2 = combined_points[i - 1], combined_points[i]
                d = haversine(p1['latitude'], p1['longitude'],
                              p2['latitude'], p2['longitude'])
                dt = 0.0
                if p1['time'] and p2['time']:
                    dt = (datetime.fromisoformat(p2['time']) -
                          datetime.fromisoformat(p1['time'])).total_seconds()
                combined_speeds.append((d / dt * 3.6) if dt > 0 else 0.0)
            combined_speeds.insert(0, 0.0)

            merged[-1] = _build_segment(combined_points, prev['type'], combined_speeds)
        else:
            merged.append(seg)

    return merged


def _validate_segments(segments):
    """Valide les segments selon les seuils d'altitude (50m)."""
    for seg in segments:
        elev = abs(seg['elevation_change'])
        if seg['type'] == 'descent' and elev < 50:
            seg['type'] = 'pause'
        elif seg['type'] == 'lift' and elev < 50:
            seg['type'] = 'pause'
    return segments


def compute_session_stats(segments):
    """Calcule les statistiques globales d'une session à partir de ses segments."""
    stats = {
        'total_distance': 0.0,
        'total_elevation_gain': 0.0,
        'total_elevation_loss': 0.0,
        'max_speed': 0.0,
        'avg_speed': 0.0,
        'num_descents': 0,
        'duration_seconds': 0,
    }

    total_speed_weighted = 0.0
    total_moving_time = 0

    for seg in segments:
        stats['total_distance'] += seg['distance']
        stats['duration_seconds'] += seg['duration_seconds']

        if seg['elevation_change'] > 0:
            stats['total_elevation_gain'] += seg['elevation_change']
        else:
            stats['total_elevation_loss'] += abs(seg['elevation_change'])

        if seg['max_speed'] > stats['max_speed']:
            stats['max_speed'] = seg['max_speed']

        if seg['type'] == 'descent':
            stats['num_descents'] += 1

        if seg['type'] != 'pause' and seg['duration_seconds'] > 0:
            total_speed_weighted += seg['avg_speed'] * seg['duration_seconds']
            total_moving_time += seg['duration_seconds']

    if total_moving_time > 0:
        stats['avg_speed'] = total_speed_weighted / total_moving_time

    # Arrondir
    for key in stats:
        if isinstance(stats[key], float):
            stats[key] = round(stats[key], 2)

    return stats


# ---------------------------------------------------------------------------
# Matching descentes ↔ pistes OSM
# ---------------------------------------------------------------------------

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
PISTE_CACHE_TTL_DAYS = 30
MATCH_DISTANCE_THRESHOLD = 80  # mètres
MATCH_MIN_SCORE = 0.50  # 50% des points doivent matcher


def _reconstruct_relation_geometry(member_ways, ways, nodes):
    """Reconstitue la géométrie d'une relation en concaténant ses ways membres dans l'ordre."""
    # Extraire les séquences de nodes pour chaque way membre
    segments = []
    for m in member_ways:
        way_id = m['ref']
        way = ways.get(way_id)
        if not way:
            continue
        seg_nodes = []
        for nd_id in way.get('nodes', []):
            if nd_id in nodes:
                seg_nodes.append((nd_id, list(nodes[nd_id])))
        if seg_nodes:
            segments.append(seg_nodes)

    if not segments:
        return []

    # Ordonner et chaîner les segments bout à bout
    geometry = [pt for _, pt in segments[0]]
    used = {0}

    for _ in range(len(segments) - 1):
        last_node_id = segments[list(used)[-1]][-1][0] if geometry else None
        # Trouver le segment suivant dont le début ou la fin correspond
        best_idx = None
        reverse = False
        for idx, seg in enumerate(segments):
            if idx in used:
                continue
            if seg[0][0] == last_node_id:
                best_idx = idx
                reverse = False
                break
            if seg[-1][0] == last_node_id:
                best_idx = idx
                reverse = True
                break

        if best_idx is None:
            # Pas de continuation trouvée, prendre le suivant non utilisé
            for idx in range(len(segments)):
                if idx not in used:
                    best_idx = idx
                    break
            if best_idx is None:
                break

        seg = segments[best_idx]
        if reverse:
            seg = list(reversed(seg))
        # Éviter la duplication du point de jonction
        start = 1 if seg[0][0] == last_node_id else 0
        geometry.extend(pt for _, pt in seg[start:])
        used.add(best_idx)

    return geometry


def _extract_piste_name(tags):
    """Extrait le nom d'une piste depuis ses tags OSM (priorité : name:fr > name > piste:name > ref)."""
    return (tags.get('name:fr')
            or tags.get('name')
            or tags.get('piste:name')
            or tags.get('ref')
            or tags.get('piste:ref')
            or '')


def fetch_osm_pistes(min_lat, max_lat, min_lon, max_lon):
    """Récupère les pistes de ski (ways + relations) depuis Overpass API et les cache en BDD."""
    query = f"""
    [out:json][timeout:45];
    (
      way["piste:type"="downhill"]({min_lat},{min_lon},{max_lat},{max_lon});
      relation["piste:type"="downhill"]({min_lat},{min_lon},{max_lat},{max_lon});
    );
    out body;
    >;
    out skel qt;
    """
    try:
        resp = requests.post(OVERPASS_URL, data={'data': query}, timeout=45)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error("Erreur Overpass API : %s", e)
        return 0

    # Indexer les nodes
    nodes = {}
    # Indexer les ways pour reconstruire les géométries des relations
    ways = {}
    for el in data.get('elements', []):
        if el['type'] == 'node':
            nodes[el['id']] = (el['lat'], el['lon'])
        elif el['type'] == 'way':
            ways[el['id']] = el

    # Collecter les way IDs qui appartiennent à une relation de piste
    # (pour éviter les doublons : on préfère la relation qui porte le nom)
    ways_in_relations = {}

    db = get_db()
    count = 0

    # --- Traiter les relations d'abord ---
    for el in data.get('elements', []):
        if el['type'] != 'relation':
            continue
        tags = el.get('tags', {})
        if tags.get('piste:type') != 'downhill':
            continue

        rel_id = el['id']
        rel_name = _extract_piste_name(tags)
        rel_difficulty = tags.get('piste:difficulty', 'unknown')

        # Reconstituer la géométrie à partir des ways membres
        member_ways = [m for m in el.get('members', []) if m['type'] == 'way']
        geometry = _reconstruct_relation_geometry(member_ways, ways, nodes)

        if len(geometry) < 2:
            continue

        # Marquer les ways membres pour éviter les doublons
        for m in member_ways:
            ways_in_relations[m['ref']] = rel_id

        lats = [p[0] for p in geometry]
        lons = [p[1] for p in geometry]

        db.execute("""
            INSERT OR REPLACE INTO osm_pistes
            (osm_id, name, difficulty, geometry, bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (rel_id, rel_name, rel_difficulty, json.dumps(geometry),
              min(lats), max(lats), min(lons), max(lons)))
        count += 1

    # --- Traiter les ways individuels (hors relations) ---
    for el in data.get('elements', []):
        if el['type'] != 'way':
            continue
        tags = el.get('tags', {})
        if tags.get('piste:type') != 'downhill':
            continue

        osm_id = el['id']
        # Sauter les ways déjà inclus dans une relation
        if osm_id in ways_in_relations:
            continue

        name = _extract_piste_name(tags)
        difficulty = tags.get('piste:difficulty', 'unknown')

        # Construire la géométrie
        geometry = []
        for nd_id in el.get('nodes', []):
            if nd_id in nodes:
                geometry.append(list(nodes[nd_id]))

        if len(geometry) < 2:
            continue

        lats = [p[0] for p in geometry]
        lons = [p[1] for p in geometry]

        db.execute("""
            INSERT OR REPLACE INTO osm_pistes
            (osm_id, name, difficulty, geometry, bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        """, (osm_id, name, difficulty, json.dumps(geometry),
              min(lats), max(lats), min(lons), max(lons)))
        count += 1

    # Enregistrer la zone fetchée
    db.execute("""
        INSERT INTO osm_fetch_zones (min_lat, max_lat, min_lon, max_lon, fetched_at)
        VALUES (?, ?, ?, ?, datetime('now'))
    """, (min_lat, max_lat, min_lon, max_lon))
    db.commit()
    logger.info("Overpass : %d pistes récupérées (ways + relations) pour bbox [%.4f,%.4f,%.4f,%.4f]",
                count, min_lat, min_lon, max_lat, max_lon)
    return count


def ensure_pistes_cached(session_id):
    """Vérifie que les pistes OSM sont en cache pour la zone de la session."""
    db = get_db()

    # Calculer la bounding box des points de la session
    bbox = db.execute("""
        SELECT MIN(tp.latitude) as min_lat, MAX(tp.latitude) as max_lat,
               MIN(tp.longitude) as min_lon, MAX(tp.longitude) as max_lon
        FROM track_points tp
        JOIN tracks t ON tp.track_id = t.id
        WHERE t.session_id = ?
    """, (session_id,)).fetchone()

    if not bbox or bbox['min_lat'] is None:
        return

    # Ajouter une marge de 0.01° (~1km)
    margin = 0.01
    min_lat = bbox['min_lat'] - margin
    max_lat = bbox['max_lat'] + margin
    min_lon = bbox['min_lon'] - margin
    max_lon = bbox['max_lon'] + margin

    # Vérifier si on a déjà fetché cette zone récemment
    existing = db.execute("""
        SELECT id FROM osm_fetch_zones
        WHERE min_lat <= ? AND max_lat >= ? AND min_lon <= ? AND max_lon >= ?
        AND fetched_at > datetime('now', ?)
    """, (min_lat, max_lat, min_lon, max_lon, f'-{PISTE_CACHE_TTL_DAYS} days')).fetchone()

    if existing:
        return

    fetch_osm_pistes(min_lat, max_lat, min_lon, max_lon)


def point_to_segment_distance(lat, lon, lat1, lon1, lat2, lon2):
    """Distance minimale d'un point à un segment de droite (en mètres, approx Haversine)."""
    # Vecteurs en coordonnées plates (approximation locale)
    cos_lat = cos(radians(lat))
    dx = (lon2 - lon1) * cos_lat
    dy = lat2 - lat1
    px = (lon - lon1) * cos_lat
    py = lat - lat1

    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-12:
        return haversine(lat, lon, lat1, lon1)

    t = max(0, min(1, (px * dx + py * dy) / seg_len_sq))
    proj_lon = lon1 + t * (lon2 - lon1)
    proj_lat = lat1 + t * (lat2 - lat1)

    return haversine(lat, lon, proj_lat, proj_lon)


def point_to_polyline_distance(lat, lon, polyline):
    """Distance minimale d'un point à une polyline (liste de [lat, lon])."""
    min_dist = float('inf')
    for i in range(len(polyline) - 1):
        d = point_to_segment_distance(
            lat, lon,
            polyline[i][0], polyline[i][1],
            polyline[i + 1][0], polyline[i + 1][1]
        )
        if d < min_dist:
            min_dist = d
    return min_dist


def match_track_to_piste(track_id):
    """Matche un track de descente à la piste OSM la plus proche."""
    db = get_db()

    # Récupérer les points du track (échantillonner 1 sur 3)
    points = db.execute("""
        SELECT latitude, longitude FROM track_points
        WHERE track_id = ? ORDER BY point_order
    """, (track_id,)).fetchall()

    if len(points) < 3:
        return

    sampled = points[::3]
    if not sampled:
        return

    # Bounding box du track pour filtrer les pistes candidates
    lats = [p['latitude'] for p in points]
    lons = [p['longitude'] for p in points]
    margin = 0.005  # ~500m
    track_min_lat = min(lats) - margin
    track_max_lat = max(lats) + margin
    track_min_lon = min(lons) - margin
    track_max_lon = max(lons) + margin

    # Pistes candidates par intersection de bbox
    pistes = db.execute("""
        SELECT osm_id, name, difficulty, geometry
        FROM osm_pistes
        WHERE bbox_max_lat >= ? AND bbox_min_lat <= ?
        AND bbox_max_lon >= ? AND bbox_min_lon <= ?
    """, (track_min_lat, track_max_lat, track_min_lon, track_max_lon)).fetchall()

    if not pistes:
        return

    # Scorer toutes les pistes candidates
    scored = []
    for piste in pistes:
        polyline = json.loads(piste['geometry'])
        if len(polyline) < 2:
            continue

        close_count = 0
        for pt in sampled:
            dist = point_to_polyline_distance(pt['latitude'], pt['longitude'], polyline)
            if dist <= MATCH_DISTANCE_THRESHOLD:
                close_count += 1

        score = close_count / len(sampled)
        if score >= MATCH_MIN_SCORE:
            scored.append((piste, score))

    if not scored:
        db.execute("""
            UPDATE tracks SET piste_osm_id = NULL, piste_name = NULL, piste_difficulty = NULL, match_confidence = NULL
            WHERE id = ?
        """, (track_id,))
        return

    # Trier par score desc, puis préférer les pistes nommées à score égal (±5%)
    scored.sort(key=lambda x: (round(x[1], 1), 1 if x[0]['name'] else 0), reverse=True)
    best_piste, best_score = scored[0]

    # Si la meilleure est sans nom, chercher une nommée avec un score proche (≥90% du best)
    if not best_piste['name']:
        for piste, score in scored[1:]:
            if score < best_score * 0.90:
                break
            if piste['name']:
                best_piste = piste
                best_score = score
                break

    # Résoudre le nom final
    piste_name = best_piste['name']
    if not piste_name:
        diff_labels = {
            'novice': 'Verte', 'easy': 'Verte',
            'intermediate': 'Bleue', 'advanced': 'Rouge',
            'expert': 'Noire', 'freeride': 'Freeride'
        }
        piste_name = diff_labels.get(best_piste['difficulty'], 'Piste')
    db.execute("""
        UPDATE tracks SET piste_osm_id = ?, piste_name = ?, piste_difficulty = ?, match_confidence = ?
        WHERE id = ?
    """, (best_piste['osm_id'], piste_name, best_piste['difficulty'],
          round(best_score, 2), track_id))


def _load_reference_pistes():
    """Charge le fichier de référence des pistes officielles des 3 Vallées."""
    ref_path = os.path.join(app.static_folder, 'pistes_3v_reference.json')
    if not os.path.exists(ref_path):
        return []
    try:
        with open(ref_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        all_pistes = []
        for resort in data.get('resorts', {}).values():
            for p in resort.get('pistes', []):
                all_pistes.append(p)
        return all_pistes
    except Exception as e:
        logger.warning("Impossible de charger le fichier de référence pistes : %s", e)
        return []


def _enrich_unnamed_pistes(session_id):
    """Enrichit les noms des pistes OSM sans nom via le fichier de référence officiel."""
    db = get_db()
    ref_pistes = _load_reference_pistes()
    if not ref_pistes:
        return

    # Récupérer les descentes matchées mais sans vrai nom (fallback difficulté)
    diff_labels = {'Verte', 'Bleue', 'Rouge', 'Noire', 'Freeride', 'Piste'}
    matched = db.execute("""
        SELECT t.id, t.piste_osm_id, t.piste_name, t.piste_difficulty, t.match_confidence,
               p.name as osm_name
        FROM tracks t
        LEFT JOIN osm_pistes p ON t.piste_osm_id = p.osm_id
        WHERE t.session_id = ? AND t.segment_type = 'descent'
        AND t.piste_osm_id IS NOT NULL
    """, (session_id,)).fetchall()

    # Mapping difficulté OSM → officiel
    diff_map = {
        'novice': 'novice', 'easy': 'novice',
        'intermediate': 'intermediate',
        'advanced': 'advanced',
        'expert': 'expert', 'freeride': 'expert'
    }

    # Noms déjà utilisés (vrais noms, pas fallback)
    used_names = {t['piste_name'] for t in matched if t['piste_name'] and t['piste_name'] not in diff_labels}

    enriched = 0
    for track in matched:
        if track['piste_name'] and track['piste_name'] not in diff_labels:
            continue  # A déjà un vrai nom

        osm_diff = track['piste_difficulty'] or ''
        ref_diff = diff_map.get(osm_diff, osm_diff)

        # Chercher les pistes de référence de la même difficulté, pas encore assignées
        candidates = [p for p in ref_pistes
                      if p['difficulty'] == ref_diff and p['name'] not in used_names]

        if len(candidates) == 1:
            # Une seule candidate → on l'assigne
            db.execute("UPDATE tracks SET piste_name = ? WHERE id = ?",
                       (candidates[0]['name'], track['id']))
            used_names.add(candidates[0]['name'])
            enriched += 1

    if enriched:
        db.commit()
        logger.info("Enrichissement noms : %d pistes nommées depuis référence officielle (session %d)",
                    enriched, session_id)


def match_session_pistes(session_id):
    """Matche toutes les descentes d'une session aux pistes OSM."""
    ensure_pistes_cached(session_id)

    db = get_db()
    descents = db.execute("""
        SELECT id FROM tracks
        WHERE session_id = ? AND segment_type = 'descent'
    """, (session_id,)).fetchall()

    for descent in descents:
        match_track_to_piste(descent['id'])

    db.commit()

    # Enrichissement post-matching : noms depuis référence officielle
    _enrich_unnamed_pistes(session_id)

    logger.info("Matching pistes terminé pour session %d : %d descentes", session_id, len(descents))


# ---------------------------------------------------------------------------
# Routes — Pages
# ---------------------------------------------------------------------------


@app.route('/')
@login_required
def index():
    """Page d'accueil — dashboard avec stats globales."""
    return render_template('index.html')


@app.route('/day/<date>')
@login_required
def day_detail(date):
    """Page detail d'une journee de ski (rendue cote client)."""
    return render_template('index.html')


# ---------------------------------------------------------------------------
# Routes — API Health
# ---------------------------------------------------------------------------


@app.route('/api/health')
def health():
    """Health check pour PyDeploy."""
    return jsonify({
        'status': 'ok',
        'version': __version__
    })

# ---------------------------------------------------------------------------
# Routes — API Upload
# ---------------------------------------------------------------------------


@app.route('/api/upload', methods=['POST'])
@login_required
def upload_gpx():
    """Upload et traitement d'un fichier GPX avec groupement par jour et déduplication."""
    if 'file' not in request.files:
        return jsonify({'error': 'Aucun fichier fourni'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nom de fichier vide'}), 400

    # Validation de l'extension
    if not file.filename.lower().endswith('.gpx'):
        return jsonify({'error': 'Seuls les fichiers .gpx sont acceptés'}), 400

    try:
        # Lire le contenu
        raw = file.read()
        # Gérer BOM UTF-8 et encodages variés
        try:
            file_content = raw.decode('utf-8-sig')
        except UnicodeDecodeError:
            file_content = raw.decode('latin-1')

        # Sauvegarder le fichier original
        upload_dir = app.config['UPLOAD_FOLDER']
        os.makedirs(upload_dir, exist_ok=True)
        safe_filename = Path(file.filename).name
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        saved_name = f"{timestamp}_{safe_filename}"
        filepath = os.path.join(upload_dir, saved_name)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(file_content)
        logger.info("Fichier GPX sauvegardé : %s", filepath)

        # Parser le GPX
        points = parse_gpx(file_content)
        if not points:
            return jsonify({'error': 'Aucun point GPS trouvé dans le fichier'}), 400

        # Grouper les points par date
        points_by_date = defaultdict(list)
        for pt in points:
            if pt['time']:
                date_str = datetime.fromisoformat(pt['time']).strftime('%Y-%m-%d')
            else:
                date_str = datetime.now().strftime('%Y-%m-%d')
            points_by_date[date_str].append(pt)

        db = get_db()
        user_id = session['user_id']
        total_new_points = 0
        days_updated = []

        for date_str, new_points in points_by_date.items():
            # Trouver ou créer la session pour ce jour
            sess = db.execute(
                "SELECT id FROM sessions WHERE user_id = ? AND date = ?",
                (user_id, date_str)
            ).fetchone()

            if sess:
                session_id = sess['id']
                # Charger les points existants
                existing_points = []
                tracks = db.execute("SELECT id FROM tracks WHERE session_id = ?", (session_id,)).fetchall()
                for track in tracks:
                    pts = db.execute(
                        "SELECT latitude, longitude, elevation, time FROM track_points WHERE track_id = ? ORDER BY point_order",
                        (track['id'],)
                    ).fetchall()
                    existing_points.extend([dict(p) for p in pts])

                # Dédupliquer : utiliser le timestamp comme clé
                existing_timestamps = set()
                for p in existing_points:
                    if p['time']:
                        existing_timestamps.add(p['time'][:19])  # Tronquer à la seconde

                # Ne garder que les nouveaux points
                unique_new = []
                for p in new_points:
                    ts = p['time'][:19] if p['time'] else None
                    if ts and ts not in existing_timestamps:
                        unique_new.append(p)
                        existing_timestamps.add(ts)

                if not unique_new and existing_points:
                    # Rien de nouveau, skip
                    continue

                # Fusionner et trier par temps
                all_points = existing_points + unique_new
                all_points.sort(key=lambda p: p['time'] or '')
                total_new_points += len(unique_new)

                # Supprimer les anciens tracks et points
                db.execute("DELETE FROM tracks WHERE session_id = ?", (session_id,))
            else:
                # Nouvelle session pour ce jour
                months_fr = {
                    'January': 'janvier', 'February': 'février', 'March': 'mars',
                    'April': 'avril', 'May': 'mai', 'June': 'juin',
                    'July': 'juillet', 'August': 'août', 'September': 'septembre',
                    'October': 'octobre', 'November': 'novembre', 'December': 'décembre'
                }
                session_name = datetime.strptime(date_str, '%Y-%m-%d').strftime('%-d %B %Y')
                for en, fr in months_fr.items():
                    session_name = session_name.replace(en, fr)

                cursor = db.execute(
                    """INSERT INTO sessions (name, date, user_id, total_distance, total_elevation_gain,
                       total_elevation_loss, max_speed, avg_speed, num_descents, duration_seconds)
                       VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0)""",
                    (session_name, date_str, user_id)
                )
                session_id = cursor.lastrowid
                all_points = new_points
                all_points.sort(key=lambda p: p['time'] or '')
                total_new_points += len(new_points)

            # Recalculer segments et stats
            segments = detect_segments(all_points)
            stats = compute_session_stats(segments)

            # Sauvegarder les tracks et points
            for seg in segments:
                track_cursor = db.execute(
                    """INSERT INTO tracks
                       (session_id, segment_type, start_time, end_time, distance,
                        elevation_change, avg_speed, max_speed, duration_seconds)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (session_id, seg['type'], seg['start_time'], seg['end_time'],
                     seg['distance'], seg['elevation_change'], seg['avg_speed'],
                     seg['max_speed'], seg['duration_seconds'])
                )
                track_id = track_cursor.lastrowid
                point_data = [(track_id, pt['latitude'], pt['longitude'], pt['elevation'], pt['time'], None, order)
                              for order, pt in enumerate(seg['points'])]
                db.executemany(
                    "INSERT INTO track_points (track_id, latitude, longitude, elevation, time, speed, point_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    point_data
                )

            # Mettre à jour les stats de la session
            db.execute(
                """UPDATE sessions SET
                   total_distance = ?, total_elevation_gain = ?, total_elevation_loss = ?,
                   max_speed = ?, avg_speed = ?, num_descents = ?, duration_seconds = ?
                   WHERE id = ?""",
                (stats['total_distance'], stats['total_elevation_gain'],
                 stats['total_elevation_loss'], stats['max_speed'],
                 stats['avg_speed'], stats['num_descents'],
                 stats['duration_seconds'], session_id)
            )

            days_updated.append(date_str)

        db.commit()
        logger.info("Import GPX : %d jours mis à jour, %d nouveaux points", len(days_updated), total_new_points)

        return jsonify({
            'days_updated': len(days_updated),
            'new_points': total_new_points,
            'dates': days_updated
        }), 201

    except gpxpy.gpx.GPXXMLSyntaxException:
        logger.warning("Fichier GPX invalide uploadé : %s", file.filename)
        return jsonify({'error': 'Fichier GPX invalide ou mal formé'}), 400
    except Exception as e:
        logger.exception("Erreur lors du traitement du fichier GPX")
        return jsonify({'error': f'Erreur de traitement : {str(e)}'}), 500

# ---------------------------------------------------------------------------
# Routes — API Données
# ---------------------------------------------------------------------------


@app.route('/api/dates')
@login_required
def api_dates():
    """Liste les dates ayant des données pour l'utilisateur."""
    db = get_db()
    dates = db.execute(
        "SELECT date FROM sessions WHERE user_id = ? ORDER BY date DESC",
        (session['user_id'],)
    ).fetchall()
    return jsonify([d['date'] for d in dates])


@app.route('/api/sessions')
@login_required
def api_sessions():
    """Liste les sessions de l'utilisateur connecté."""
    try:
        db = get_db()
        sessions = db.execute(
            """SELECT id, name, date, total_distance, total_elevation_gain,
                      total_elevation_loss, max_speed, avg_speed, num_descents,
                      duration_seconds, created_at
               FROM sessions WHERE user_id = ? ORDER BY date DESC""",
            (session['user_id'],)
        ).fetchall()

        return jsonify([dict(s) for s in sessions])

    except Exception as e:
        logger.exception("Erreur lors de la récupération des sessions")
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>')
@login_required
def api_session_detail(session_id):
    """Détail d'une session avec ses stats et segments."""
    try:
        db = get_db()
        sess = db.execute(
            "SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, session['user_id'])
        ).fetchone()

        if not sess:
            return jsonify({'error': 'Session non trouvée'}), 404

        tracks = db.execute(
            """SELECT id, segment_type, start_time, end_time, distance,
                      elevation_change, avg_speed, max_speed, duration_seconds
               FROM tracks WHERE session_id = ? ORDER BY start_time""",
            (session_id,)
        ).fetchall()

        return jsonify({
            'session': dict(sess),
            'tracks': [dict(t) for t in tracks]
        })

    except Exception as e:
        logger.exception("Erreur lors de la récupération de la session %d", session_id)
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>', methods=['DELETE'])
@login_required
def api_delete_session(session_id):
    """Supprime une session et toutes ses données associées."""
    try:
        db = get_db()
        sess = db.execute(
            "SELECT id FROM sessions WHERE id = ? AND user_id = ?", (session_id, session['user_id'])
        ).fetchone()

        if not sess:
            return jsonify({'error': 'Session non trouvée'}), 404

        db.execute("DELETE FROM sessions WHERE id = ? AND user_id = ?", (session_id, session['user_id']))
        db.commit()
        logger.info("Session supprimée : id=%d", session_id)

        return jsonify({'message': 'Session supprimée'}), 200

    except Exception as e:
        logger.exception("Erreur lors de la suppression de la session %d", session_id)
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/tracks')
@login_required
def api_session_tracks(session_id):
    """Retourne les traces GPS d'une session pour affichage Leaflet."""
    try:
        db = get_db()
        sess = db.execute(
            "SELECT id FROM sessions WHERE id = ? AND user_id = ?", (session_id, session['user_id'])
        ).fetchone()

        if not sess:
            return jsonify({'error': 'Session non trouvée'}), 404

        tracks = db.execute(
            """SELECT id, segment_type, start_time, end_time, distance,
                      elevation_change, avg_speed, max_speed, duration_seconds,
                      piste_osm_id, piste_name, piste_difficulty, match_confidence
               FROM tracks WHERE session_id = ? ORDER BY start_time""",
            (session_id,)
        ).fetchall()

        result = []
        for track in tracks:
            points = db.execute(
                """SELECT latitude, longitude, elevation, time, speed
                   FROM track_points WHERE track_id = ?
                   ORDER BY point_order""",
                (track['id'],)
            ).fetchall()

            result.append({
                'track': dict(track),
                'points': [dict(p) for p in points]
            })

        # Trigger matching si des descentes n'ont pas de match
        has_unmatched = any(
            t['track']['segment_type'] == 'descent' and t['track'].get('piste_osm_id') is None
            for t in result
        )
        if has_unmatched:
            try:
                match_session_pistes(session_id)
                # Re-fetch les tracks après matching
                tracks = db.execute(
                    """SELECT id, segment_type, start_time, end_time, distance,
                              elevation_change, avg_speed, max_speed, duration_seconds,
                              piste_osm_id, piste_name, piste_difficulty, match_confidence
                       FROM tracks WHERE session_id = ? ORDER BY start_time""",
                    (session_id,)
                ).fetchall()
                result = []
                for track in tracks:
                    points = db.execute(
                        """SELECT latitude, longitude, elevation, time, speed
                           FROM track_points WHERE track_id = ?
                           ORDER BY point_order""",
                        (track['id'],)
                    ).fetchall()
                    result.append({
                        'track': dict(track),
                        'points': [dict(p) for p in points]
                    })
            except Exception as e:
                logger.warning("Erreur matching pistes : %s", e)

        return jsonify(result)

    except Exception as e:
        logger.exception("Erreur lors de la récupération des tracks de la session %d",
                         session_id)
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/pistes')
@login_required
def api_session_pistes(session_id):
    """Retourne les pistes OSM dans la zone de la session."""
    try:
        db = get_db()
        sess = db.execute(
            "SELECT id FROM sessions WHERE id = ? AND user_id = ?", (session_id, session['user_id'])
        ).fetchone()
        if not sess:
            return jsonify({'error': 'Session non trouvée'}), 404

        ensure_pistes_cached(session_id)

        # Bounding box de la session
        bbox = db.execute("""
            SELECT MIN(tp.latitude) as min_lat, MAX(tp.latitude) as max_lat,
                   MIN(tp.longitude) as min_lon, MAX(tp.longitude) as max_lon
            FROM track_points tp
            JOIN tracks t ON tp.track_id = t.id
            WHERE t.session_id = ?
        """, (session_id,)).fetchone()

        if not bbox or bbox['min_lat'] is None:
            return jsonify([])

        margin = 0.01
        pistes = db.execute("""
            SELECT osm_id, name, difficulty, geometry
            FROM osm_pistes
            WHERE bbox_max_lat >= ? AND bbox_min_lat <= ?
            AND bbox_max_lon >= ? AND bbox_min_lon <= ?
        """, (bbox['min_lat'] - margin, bbox['max_lat'] + margin,
              bbox['min_lon'] - margin, bbox['max_lon'] + margin)).fetchall()

        return jsonify([{
            'osm_id': p['osm_id'],
            'name': p['name'],
            'difficulty': p['difficulty'],
            'geometry': json.loads(p['geometry'])
        } for p in pistes])

    except Exception as e:
        logger.exception("Erreur récupération pistes session %d", session_id)
        return jsonify({'error': str(e)}), 500


@app.route('/api/sessions/<int:session_id>/rematch', methods=['POST'])
@login_required
def api_rematch_pistes(session_id):
    """Force le re-matching des descentes aux pistes OSM."""
    try:
        db = get_db()
        sess = db.execute(
            "SELECT id FROM sessions WHERE id = ? AND user_id = ?", (session_id, session['user_id'])
        ).fetchone()
        if not sess:
            return jsonify({'error': 'Session non trouvée'}), 404

        # Reset les matchs existants
        db.execute("""
            UPDATE tracks SET piste_osm_id = NULL, piste_name = NULL,
                   piste_difficulty = NULL, match_confidence = NULL
            WHERE session_id = ? AND segment_type = 'descent'
        """, (session_id,))
        db.commit()

        match_session_pistes(session_id)
        return jsonify({'message': 'Re-matching terminé'})

    except Exception as e:
        logger.exception("Erreur rematch session %d", session_id)
        return jsonify({'error': str(e)}), 500


@app.route('/api/stats')
@login_required
def api_global_stats():
    """Statistiques globales agrégées sur les sessions de l'utilisateur."""
    try:
        db = get_db()
        stats = db.execute(
            """SELECT
                COUNT(*) as total_sessions,
                COALESCE(SUM(total_distance), 0) as total_distance,
                COALESCE(SUM(total_elevation_gain), 0) as total_elevation_gain,
                COALESCE(SUM(total_elevation_loss), 0) as total_elevation_loss,
                COALESCE(MAX(max_speed), 0) as max_speed,
                COALESCE(SUM(num_descents), 0) as total_descents,
                COALESCE(SUM(duration_seconds), 0) as total_duration
               FROM sessions WHERE user_id = ?""",
            (session['user_id'],)
        ).fetchone()

        result = dict(stats)

        # Vitesse moyenne pondérée
        avg_row = db.execute(
            """SELECT
                CASE WHEN SUM(duration_seconds) > 0
                     THEN SUM(avg_speed * duration_seconds) / SUM(duration_seconds)
                     ELSE 0 END as avg_speed
               FROM sessions
               WHERE duration_seconds > 0 AND user_id = ?""",
            (session['user_id'],)
        ).fetchone()
        result['avg_speed'] = round(avg_row['avg_speed'], 2) if avg_row else 0

        # Arrondir les flottants
        for key in ['total_distance', 'total_elevation_gain', 'total_elevation_loss',
                     'max_speed']:
            result[key] = round(result[key], 2)

        return jsonify(result)

    except Exception as e:
        logger.exception("Erreur lors du calcul des stats globales")
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Lancement
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    debug = os.environ.get('DEBUG', 'False').lower() in ('true', '1')
    app.run(debug=debug, host='0.0.0.0', port=5000)
