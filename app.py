"""
Ski Tracker — Application Flask pour le suivi de sessions de ski.
Upload de fichiers GPX, détection automatique des descentes/remontées,
statistiques et visualisation sur carte.
"""

__version__ = '1.1.0'

import os
import logging
import sqlite3
from datetime import datetime
from functools import wraps
from math import radians, cos, sin, asin, sqrt
from pathlib import Path

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
        elev_delta = (curr['elevation'] or 0) - (prev['elevation'] or 0)

        speeds.append(speed)
        elevation_deltas.append(elev_delta)

    return speeds, elevation_deltas


def classify_point(speed, elev_delta):
    """Classifie un point individuel en phase."""
    if speed < 2.0:
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


def save_session(db, name, date_str, stats, segments, user_id):
    """Sauvegarde une session complète en BDD (session + tracks + points)."""
    cursor = db.execute(
        """INSERT INTO sessions
           (name, date, user_id, total_distance, total_elevation_gain, total_elevation_loss,
            max_speed, avg_speed, num_descents, duration_seconds)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (name, date_str, user_id,
         stats['total_distance'], stats['total_elevation_gain'],
         stats['total_elevation_loss'], stats['max_speed'],
         stats['avg_speed'], stats['num_descents'],
         stats['duration_seconds'])
    )
    session_id = cursor.lastrowid

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

        # Insertion par batch pour la performance
        point_data = []
        for order, pt in enumerate(seg['points']):
            point_data.append((
                track_id, pt['latitude'], pt['longitude'],
                pt['elevation'], pt['time'], None, order
            ))

        db.executemany(
            """INSERT INTO track_points
               (track_id, latitude, longitude, elevation, time, speed, point_order)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            point_data
        )

    db.commit()
    return session_id

# ---------------------------------------------------------------------------
# Routes — Pages
# ---------------------------------------------------------------------------


@app.route('/')
@login_required
def index():
    """Page d'accueil — dashboard avec stats globales."""
    return render_template('index.html')


@app.route('/session/<int:session_id>')
@login_required
def session_detail(session_id):
    """Page de détail d'une session (carte + stats)."""
    db = get_db()
    sess = db.execute(
        "SELECT * FROM sessions WHERE id = ? AND user_id = ?", (session_id, session['user_id'])
    ).fetchone()
    if not sess:
        return render_template('index.html'), 404
    return render_template('session.html', session=dict(sess))

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
    """Upload et traitement d'un fichier GPX."""
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

        # Nom de session dérivé du nom de fichier
        session_name = Path(file.filename).stem.replace('_', ' ').replace('-', ' ')

        # Date de session extraite du premier point
        session_date = datetime.now().strftime('%Y-%m-%d')
        if points[0]['time']:
            try:
                session_date = datetime.fromisoformat(points[0]['time']).strftime('%Y-%m-%d')
            except (ValueError, TypeError):
                pass

        # Détection des segments
        segments = detect_segments(points)

        # Calcul des stats
        stats = compute_session_stats(segments)

        # Sauvegarde en BDD
        db = get_db()
        session_id = save_session(db, session_name, session_date, stats, segments, session['user_id'])
        logger.info("Session créée : id=%d, name=%s, %d segments",
                     session_id, session_name, len(segments))

        return jsonify({
            'id': session_id,
            'name': session_name,
            'date': session_date,
            'stats': stats,
            'num_segments': len(segments)
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
                      elevation_change, avg_speed, max_speed, duration_seconds
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

        return jsonify(result)

    except Exception as e:
        logger.exception("Erreur lors de la récupération des tracks de la session %d",
                         session_id)
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
