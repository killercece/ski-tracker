# Ski Tracker

Application web pour visualiser et analyser les données GPS de séjours au ski.

## Fonctionnalités
- Upload de fichiers GPX
- Détection automatique des descentes, remontées et pauses
- Statistiques détaillées (distance, dénivelé, vitesse moyenne/max)
- Carte interactive avec traces colorées par type de segment
- Dashboard avec stats globales

## Installation

```bash
# Cloner ou initialiser le projet
cd /projects/ski-tracker

# Créer un environnement virtuel
python3 -m venv venv
source venv/bin/activate  # Linux/macOS
# ou sur Windows : venv\Scripts\activate

# Installer les dépendances
pip install -r requirements.txt

# Copier le fichier d'environnement
cp .env.example .env

# Initialiser la base de données
python setup.py
```

## Utilisation

```bash
# Activer l'environnement virtuel
source venv/bin/activate

# Lancer l'application
python app.py
```

Accédez à l'application via http://localhost:5000

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/sessions` - Liste des sessions
- `GET /api/sessions/<id>` - Détail d'une session
- `GET /api/sessions/<id>/tracks` - Traces GPS d'une session
- `POST /api/upload` - Upload d'un fichier GPX
- `DELETE /api/sessions/<id>` - Supprimer une session
- `GET /api/stats` - Statistiques globales

## Déploiement PyDeploy

Ce projet est conçu pour être déployé via PyDeploy.
