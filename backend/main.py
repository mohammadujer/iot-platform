
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Dict
from datetime import datetime
import secrets
import math

from database import SessionLocal, engine
from models import Base, Project, APIKey, Device, SensorReading


# Create database tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Simple IoT Platform")


# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Database connection
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Request models
class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class APIKeyCreate(BaseModel):
    name: str


class IngestData(BaseModel):
    device_id: str
    metrics: Dict[str, float]


# Home
@app.get("/")
def home():
    return {"message": "IoT Platform Backend Running"}


# Health check
@app.get("/health")
def health():
    return {"status": "healthy"}


# Create project
@app.post("/api/projects")
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):

    if not project.name.strip():
        raise HTTPException(status_code=400, detail="Project name cannot be empty")

    new_project = Project(
        name=project.name.strip(),
        description=project.description
    )

    db.add(new_project)
    db.commit()
    db.refresh(new_project)

    return new_project


# Get all projects
@app.get("/api/projects")
def get_projects(db: Session = Depends(get_db)):

    projects = db.query(Project).all()
    result = []

    for project in projects:

        device_count = (
            db.query(Device)
            .filter(Device.project_id == project.id)
            .count()
        )

        result.append({
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "created_at": project.created_at,
            "device_count": device_count
        })

    return result


# Get one project
@app.get("/api/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)):

    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return project


# Generate API key
@app.post("/api/projects/{project_id}/api-keys")
def generate_api_key(
    project_id: int,
    api_key_data: APIKeyCreate,
    db: Session = Depends(get_db)
):

    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not api_key_data.name.strip():
        raise HTTPException(status_code=400, detail="API key name cannot be empty")

    generated_key = "iotk_" + secrets.token_hex(24)

    new_key = APIKey(
        project_id=project_id,
        name=api_key_data.name.strip(),
        key=generated_key
    )

    db.add(new_key)
    db.commit()
    db.refresh(new_key)

    # Show the secret only when it is generated
    return {
        "id": new_key.id,
        "name": new_key.name,
        "api_key": generated_key,
        "message": "Copy this API key and use it in your device firmware."
    }


# Get API key information
# Secret key values are intentionally not returned here.
@app.get("/api/projects/{project_id}/api-keys")
def get_api_keys(project_id: int, db: Session = Depends(get_db)):

    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    keys = (
        db.query(APIKey)
        .filter(APIKey.project_id == project_id)
        .all()
    )

    return [
        {
            "id": key.id,
            "name": key.name,
            "created_at": key.created_at
        }
        for key in keys
    ]


# Receive sensor data from ESP32 / Pico boards
@app.post("/api/ingest")
def ingest_data(
    data: IngestData,
    x_api_key: str = Header(None),
    db: Session = Depends(get_db)
):

    # Check API key
    if not x_api_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    api_key = (
        db.query(APIKey)
        .filter(APIKey.key == x_api_key)
        .first()
    )

    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Validate device ID
    device_id = data.device_id.strip()

    if not device_id:
        raise HTTPException(status_code=400, detail="Device ID cannot be empty")

    # Validate metrics
    if not data.metrics:
        raise HTTPException(status_code=400, detail="No metrics received")

    for metric_name, metric_value in data.metrics.items():

        if not metric_name.strip():
            raise HTTPException(
                status_code=400,
                detail="Metric name cannot be empty"
            )

        if not math.isfinite(metric_value):
            raise HTTPException(
                status_code=400,
                detail=f"Invalid value for metric: {metric_name}"
            )

    project_id = api_key.project_id
    current_time = datetime.utcnow()

    # Find device in this project
    device = (
        db.query(Device)
        .filter(
            Device.project_id == project_id,
            Device.device_id == device_id
        )
        .first()
    )

    # Automatically register a new device
    if not device:

        device = Device(
            project_id=project_id,
            device_id=device_id,
            last_seen=current_time
        )

        db.add(device)
        db.commit()
        db.refresh(device)

    # Update last seen time
    device.last_seen = current_time

    # Store every received metric
    for metric_name, metric_value in data.metrics.items():

        reading = SensorReading(
            device_id=device.id,
            metric_name=metric_name.strip(),
            metric_value=float(metric_value)
        )

        db.add(reading)

    db.commit()

    return {
        "status": "success",
        "message": "Data stored successfully",
        "project_id": project_id,
        "device_id": device_id,
        "metrics_received": data.metrics
    }


# Get all devices in a project
@app.get("/api/projects/{project_id}/devices")
def get_project_devices(project_id: int, db: Session = Depends(get_db)):

    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    devices = (
        db.query(Device)
        .filter(Device.project_id == project_id)
        .all()
    )

    result = []

    for device in devices:

        latest_readings = {}

        readings = (
            db.query(SensorReading)
            .filter(SensorReading.device_id == device.id)
            .order_by(SensorReading.timestamp.desc())
            .limit(100)
            .all()
        )

        # Keep only the latest value of each metric
        for reading in readings:

            if reading.metric_name not in latest_readings:

                latest_readings[reading.metric_name] = {
                    "value": reading.metric_value,
                    "timestamp": reading.timestamp
                }

        # Device online/offline status
        if device.last_seen:
            seconds_diff = (
                datetime.utcnow() - device.last_seen
            ).total_seconds()

            status = "online" if seconds_diff < 60 else "offline"
        else:
            status = "offline"

        result.append({
            "id": device.id,
            "device_id": device.device_id,
            "last_seen": device.last_seen,
            "status": status,
            "latest_readings": latest_readings
        })

    return result


# Get recent readings from all project devices
@app.get("/api/projects/{project_id}/readings")
def get_project_readings(project_id: int, db: Session = Depends(get_db)):

    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    devices = (
        db.query(Device)
        .filter(Device.project_id == project_id)
        .all()
    )

    device_ids = [device.id for device in devices]

    if not device_ids:
        return []

    readings = (
        db.query(SensorReading)
        .filter(SensorReading.device_id.in_(device_ids))
        .order_by(SensorReading.timestamp.desc())
        .limit(500)
        .all()
    )

    return [
        {
            "id": reading.id,
            "device_id": reading.device.device_id,
            "metric_name": reading.metric_name,
            "metric_value": reading.metric_value,
            "timestamp": reading.timestamp
        }
        for reading in readings
    ]


# Get readings for one device
@app.get("/api/devices/{device_db_id}/readings")
def get_device_readings(
    device_db_id: int,
    db: Session = Depends(get_db)
):

    device = (
        db.query(Device)
        .filter(Device.id == device_db_id)
        .first()
    )

    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    # Fetch the latest 300, then return them in chronological order
    readings = (
        db.query(SensorReading)
        .filter(SensorReading.device_id == device_db_id)
        .order_by(SensorReading.timestamp.desc())
        .limit(300)
        .all()
    )

    readings.reverse()

    return [
        {
            "id": reading.id,
            "metric_name": reading.metric_name,
            "metric_value": reading.metric_value,
            "timestamp": reading.timestamp
        }
        for reading in readings
    ]
