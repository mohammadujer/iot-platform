
import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Cpu,
  Plus,
  Key,
  Copy,
  RefreshCw,
  Wifi,
  WifiOff,
  Activity,
  Radio,
} from "lucide-react";
import "./App.css";

// Automatically uses the hostname from which the dashboard is opened.
const API_BASE = `http://${window.location.hostname}:8000`;

const CHART_COLORS = [
  "#38bdf8",
  "#22c55e",
  "#f97316",
  "#a78bfa",
  "#e879f9",
  "#facc15",
  "#fb7185",
  "#2dd4bf",
  "#818cf8",
  "#f59e0b",
];

function formatMetricName(name) {
  return String(name)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return value;

  return Number.isInteger(number)
    ? number
    : Number(number.toFixed(3));
}

// Reusable chart for any device and any metric.
function SensorChart({ title, data, color }) {
  return (
    <div className="card chart-card">
      <h2>{title}</h2>

      {data.length === 0 ? (
        <div className="empty">
          Waiting for sensor readings...
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />

            <Line
              type="monotone"
              dataKey="value"
              name={title}
              stroke={color}
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);

  const [devices, setDevices] = useState([]);
  const [readings, setReadings] = useState([]);
  const [apiKeys, setApiKeys] = useState([]);

  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");

  const [keyName, setKeyName] = useState("Device API Key");
  const [latestKey, setLatestKey] = useState("");

  const [errorMessage, setErrorMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load all projects.
  const loadProjects = useCallback(async () => {
    try {
      const response = await axios.get(
        `${API_BASE}/api/projects`
      );

      setProjects(response.data);

      setSelectedProject((current) => {
        if (!current && response.data.length > 0) {
          return response.data[0];
        }

        if (current) {
          return (
            response.data.find(
              (project) => project.id === current.id
            ) || current
          );
        }

        return null;
      });

      setErrorMessage("");
    } catch (error) {
      console.error("Could not load projects:", error);
      setErrorMessage(
        "Backend not running. Start the backend first."
      );
    }
  }, []);

  // Load devices, readings and API key information.
  const loadProjectData = useCallback(
    async (projectId, showLoader = false) => {
      if (!projectId) return;

      if (showLoader) {
        setIsRefreshing(true);
      }

      try {
        const [
          deviceResponse,
          readingResponse,
          keyResponse,
        ] = await Promise.all([
          axios.get(
            `${API_BASE}/api/projects/${projectId}/devices`
          ),

          axios.get(
            `${API_BASE}/api/projects/${projectId}/readings`
          ),

          axios.get(
            `${API_BASE}/api/projects/${projectId}/api-keys`
          ),
        ]);

        setDevices(deviceResponse.data);

        // Backend returns newest first.
        // Reverse it to keep chart points chronological.
        setReadings(
          [...readingResponse.data].reverse()
        );

        setApiKeys(keyResponse.data);

        setLastUpdated(new Date());
        setErrorMessage("");
      } catch (error) {
        console.error("Could not load project data:", error);

        setErrorMessage(
          error.response?.data?.detail ||
          "Could not load project data."
        );
      } finally {
        if (showLoader) {
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  // Create a project.
  async function createProject() {
    if (!projectName.trim()) {
      alert("Enter project / room name.");
      return;
    }

    try {
      const response = await axios.post(
        `${API_BASE}/api/projects`,
        {
          name: projectName.trim(),
          description: projectDescription.trim(),
        }
      );

      setProjectName("");
      setProjectDescription("");
      setLatestKey("");

      setSelectedProject(response.data);

      await loadProjects();

      // Ensure the newly created project remains selected.
      setSelectedProject(response.data);

      await loadProjectData(response.data.id);
    } catch (error) {
      console.error("Could not create project:", error);

      alert(
        error.response?.data?.detail ||
        "Could not create project."
      );
    }
  }

  // Generate API key.
  async function generateApiKey() {
    if (!selectedProject) {
      alert("Create/select a project first.");
      return;
    }

    try {
      const response = await axios.post(
        `${API_BASE}/api/projects/${selectedProject.id}/api-keys`,
        {
          name: keyName.trim() || "Device API Key",
        }
      );

      setLatestKey(response.data.api_key);

      await loadProjectData(selectedProject.id);
    } catch (error) {
      console.error("Could not generate API key:", error);

      alert(
        error.response?.data?.detail ||
        "Could not generate API key."
      );
    }
  }

  // Copy API key.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied to clipboard.");
    } catch (error) {
      console.error("Clipboard error:", error);

      alert(
        "Could not copy automatically. Select and copy manually."
      );
    }
  }

  // Manual refresh.
  async function refreshDashboard() {
    if (selectedProject) {
      await loadProjectData(selectedProject.id, true);
    } else {
      await loadProjects();
    }
  }

  // Load projects when the page opens.
  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Automatically refresh selected project every 3 seconds.
  useEffect(() => {
    if (!selectedProject?.id) {
      setDevices([]);
      setReadings([]);
      setApiKeys([]);
      return undefined;
    }

    const projectId = selectedProject.id;

    loadProjectData(projectId);

    const intervalId = setInterval(() => {
      loadProjectData(projectId);
    }, 3000);

    return () => clearInterval(intervalId);
  }, [selectedProject?.id, loadProjectData]);

  // ==========================================
  // DYNAMIC CHART GENERATION
  // ==========================================

  // Automatically creates a separate chart for every
  // unique combination of device ID and metric name.
  const dynamicCharts = useMemo(() => {
    const groups = new Map();

    readings.forEach((reading) => {
      const groupKey =
        `${reading.device_id}__${reading.metric_name}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          deviceId: reading.device_id,
          metricName: reading.metric_name,
          data: [],
        });
      }

      groups.get(groupKey).data.push({
        time: new Date(
          reading.timestamp
        ).toLocaleTimeString(),

        value: Number(reading.metric_value),
      });
    });

    return Array.from(groups.values()).map(
      (group, index) => ({
        ...group,

        title:
          `${group.deviceId} - ${formatMetricName(
            group.metricName
          )}`,

        color:
          CHART_COLORS[index % CHART_COLORS.length],
      })
    );
  }, [readings]);

  const onlineDeviceCount = devices.filter(
    (device) => device.status === "online"
  ).length;

  const recentReadings = [...readings]
    .reverse()
    .slice(0, 30);

  // ==========================================
  // DASHBOARD UI
  // ==========================================

  return (
    <div className="app">

      {/* SIDEBAR */}

      <aside className="sidebar">

        <div className="brand">
          <Cpu size={32} />

          <div>
            <h2>IoT Platform</h2>
            <p>Generic IoT Monitoring</p>
          </div>
        </div>

        <div className="sidebar-section">

          <p className="small-title">
            Projects / Rooms
          </p>

          {projects.length === 0 && (
            <p className="empty-small">
              No project created
            </p>
          )}

          {projects.map((project) => (
            <button
              key={project.id}

              className={
                selectedProject?.id === project.id
                  ? "project-btn active"
                  : "project-btn"
              }

              onClick={() => {
                setLatestKey("");
                setSelectedProject(project);
              }}
            >
              {project.name}
            </button>
          ))}

        </div>
      </aside>

      {/* MAIN DASHBOARD */}

      <main className="main">

        <header className="header">

          <div>
            <h1>IoT Monitoring Dashboard</h1>

            <p>
              Register projects, connect independent IoT
              devices, and monitor their sensor data in real time.
            </p>
          </div>

          <button
            className="refresh"
            onClick={refreshDashboard}
          >
            <RefreshCw size={18} />
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>

        </header>

        {errorMessage && (
          <section className="card">
            <p>{errorMessage}</p>
          </section>
        )}

        {/* CREATE PROJECT AND API KEY */}

        <section className="grid two">

          <div className="card">

            <h2>1. Create Room / Project</h2>

            <p className="hint">
              Example: Smart Room, Lab Sensor, Home IoT
            </p>

            <input
              placeholder="Enter room/project name"
              value={projectName}
              onChange={(e) =>
                setProjectName(e.target.value)
              }
            />

            <input
              placeholder="Description"
              value={projectDescription}
              onChange={(e) =>
                setProjectDescription(e.target.value)
              }
            />

            <button onClick={createProject}>
              <Plus size={18} />
              Create Project
            </button>

          </div>

          <div className="card">

            <h2>2. Generate Device API Key</h2>

            {!selectedProject ? (
              <p className="empty">
                Create/select project first.
              </p>
            ) : (
              <>
                <div className="selected-box">
                  Selected:{" "}
                  <b>{selectedProject.name}</b>
                </div>

                <input
                  placeholder="API key name"
                  value={keyName}
                  onChange={(e) =>
                    setKeyName(e.target.value)
                  }
                />

                <button onClick={generateApiKey}>
                  <Key size={18} />
                  Generate API Key
                </button>
              </>
            )}

          </div>

        </section>

        {/* NEW API KEY */}

        {latestKey && (
          <section className="card success-card">

            <h2>3. Copy This API Key</h2>

            <div className="copy-box">

              <code>{latestKey}</code>

              <button
                onClick={() => copyText(latestKey)}
              >
                <Copy size={18} />
                Copy
              </button>

            </div>

            <p className="hint">
              Add this key to the firmware of every device
              that should send readings to this project.
              Keep the key private.
            </p>

          </section>
        )}

        {/* PROJECT DASHBOARD */}

        {selectedProject && (
          <>

            <section className="project-banner">

              <div>
                <h2>{selectedProject.name}</h2>

                <p>
                  {selectedProject.description ||
                    "No description"}
                </p>
              </div>

              <span>
                Project ID: {selectedProject.id}
              </span>

            </section>

            {/* STATISTICS */}

            <section className="grid three">

              <div className="card stat">
                <Cpu />
                <p>Total Devices</p>
                <h2>{devices.length}</h2>
              </div>

              <div className="card stat">
                <Radio />
                <p>Online Devices</p>
                <h2>{onlineDeviceCount}</h2>
              </div>

              <div className="card stat">
                <Activity />
                <p>Loaded Readings</p>
                <h2>{readings.length}</h2>
              </div>

            </section>

            {/* CONNECTED DEVICES */}

            <section className="card">

              <div className="section-title-row">
                <h2>Connected Devices</h2>

                <span className="hint">
                  {lastUpdated
                    ? `Updated ${lastUpdated.toLocaleTimeString()}`
                    : "Waiting for data"}
                </span>
              </div>

              {devices.length === 0 ? (

                <div className="empty">
                  No device connected yet. Connect a board
                  to the same network as the backend and
                  send its first authenticated HTTP request.
                </div>

              ) : (

                <div className="device-grid">

                  {devices.map((device) => (

                    <div
                      className="device-card"
                      key={device.id}
                    >

                      <div className="device-top">

                        <h3>{device.device_id}</h3>

                        <span
                          className={
                            device.status === "online"
                              ? "status online"
                              : "status offline"
                          }
                        >

                          {device.status === "online" ? (
                            <Wifi size={16} />
                          ) : (
                            <WifiOff size={16} />
                          )}

                          {device.status}

                        </span>

                      </div>

                      <p className="hint">
                        Last seen:{" "}
                        {device.last_seen
                          ? new Date(
                              device.last_seen
                            ).toLocaleString()
                          : "Not available"}
                      </p>

                      {/* DYNAMIC METRIC CARDS */}

                      <div className="metric-grid">

                        {Object.entries(
                          device.latest_readings || {}
                        ).length === 0 ? (

                          <p className="empty-small">
                            No readings received yet.
                          </p>

                        ) : (

                          Object.entries(
                            device.latest_readings || {}
                          ).map(([name, data]) => (

                            <div
                              className="metric"
                              key={name}
                            >

                              <p>
                                {formatMetricName(name)}
                              </p>

                              <h2>
                                {formatValue(data.value)}
                              </h2>

                              <span className="hint">
                                {data.timestamp
                                  ? new Date(
                                      data.timestamp
                                    ).toLocaleTimeString()
                                  : ""}
                              </span>

                            </div>

                          ))

                        )}

                      </div>

                    </div>

                  ))}

                </div>

              )}

            </section>

            {/* AUTOMATIC CHARTS */}

            <h2 className="section-heading">
              Automatic Sensor Charts
            </h2>

            <p className="hint">
              A separate chart is generated automatically
              for every device and metric received by the backend.
            </p>

            {dynamicCharts.length === 0 ? (

              <section className="card empty">
                Charts will appear here after devices send
                sensor readings.
              </section>

            ) : (

              <section className="grid two">

                {dynamicCharts.map((chart) => (

                  <SensorChart
                    key={`${chart.deviceId}-${chart.metricName}`}
                    title={chart.title}
                    data={chart.data}
                    color={chart.color}
                  />

                ))}

              </section>

            )}

            {/* RECENT READINGS */}

            <section className="card">

              <h2>Recent Readings</h2>

              {recentReadings.length === 0 ? (

                <div className="empty">
                  No readings received yet.
                </div>

              ) : (

                <div className="table-wrap">

                  <table>

                    <thead>
                      <tr>
                        <th>Device</th>
                        <th>Metric</th>
                        <th>Value</th>
                        <th>Time</th>
                      </tr>
                    </thead>

                    <tbody>

                      {recentReadings.map((reading) => (

                        <tr key={reading.id}>

                          <td>{reading.device_id}</td>

                          <td>
                            {formatMetricName(
                              reading.metric_name
                            )}
                          </td>

                          <td>
                            {formatValue(
                              reading.metric_value
                            )}
                          </td>

                          <td>
                            {new Date(
                              reading.timestamp
                            ).toLocaleString()}
                          </td>

                        </tr>

                      ))}

                    </tbody>

                  </table>

                </div>

              )}

            </section>

            {/* API KEY INFORMATION */}

            <section className="card">

              <h2>API Keys</h2>

              <p className="hint">
                {apiKeys.length} key(s) created for this project.
                Secret key values are not displayed in this list.
              </p>

              {apiKeys.length > 0 && (

                <ul>
                  {apiKeys.map((key) => (

                    <li key={key.id}>
                      {key.name} —{" "}
                      {key.created_at
                        ? new Date(
                            key.created_at
                          ).toLocaleString()
                        : "Date unavailable"}
                    </li>

                  ))}
                </ul>

              )}

            </section>

          </>
        )}

      </main>
    </div>
  );
}

export default App;
