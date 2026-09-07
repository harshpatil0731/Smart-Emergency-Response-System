#include <iostream>
#include <string>
#include <sstream>
#include <vector>
#include <chrono>
#include "engine/emergency_engine.hpp"

namespace {

std::string trim(const std::string& s) {
    auto start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

std::string extractString(const std::string& json, const std::string& key) {
    std::string pattern = "\"" + key + "\":\"";
    size_t pos = json.find(pattern);
    if (pos == std::string::npos) {
        pattern = "\"" + key + "\": \"";
        pos = json.find(pattern);
        if (pos == std::string::npos) return "";
    }
    pos += pattern.length();
    size_t end = json.find('"', pos);
    if (end == std::string::npos) return "";
    return json.substr(pos, end - pos);
}

double extractDouble(const std::string& json, const std::string& key, double defaultVal = 0.0) {
    std::string pattern = "\"" + key + "\":";
    size_t pos = json.find(pattern);
    if (pos == std::string::npos) {
        pattern = "\"" + key + "\": ";
        pos = json.find(pattern);
        if (pos == std::string::npos) return defaultVal;
    }
    pos += pattern.length();
    while (pos < json.size() && (json[pos] == ' ' || json[pos] == '"')) ++pos;
    size_t end = pos;
    while (end < json.size() && (std::isdigit(json[end]) || json[end] == '.' || json[end] == '-')) ++end;
    if (pos == end) return defaultVal;
    try {
        return std::stod(json.substr(pos, end - pos));
    } catch (...) {
        return defaultVal;
    }
}

int extractInt(const std::string& json, const std::string& key, int defaultVal = 0) {
    return static_cast<int>(extractDouble(json, key, defaultVal));
}

std::int64_t currentTimestamp() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
}

emergency::TeamType parseTeamType(const std::string& s) {
    if (s == "FIRE_BRIGADE" || s == "FIRE") return emergency::TeamType::FIRE_BRIGADE;
    if (s == "RESCUE_TEAM" || s == "RESCUE") return emergency::TeamType::RESCUE_TEAM;
    return emergency::TeamType::AMBULANCE;
}

std::string teamTypeToString(emergency::TeamType t) {
    switch (t) {
        case emergency::TeamType::FIRE_BRIGADE: return "FIRE_BRIGADE";
        case emergency::TeamType::RESCUE_TEAM: return "RESCUE_TEAM";
        case emergency::TeamType::AMBULANCE: default: return "AMBULANCE";
    }
}

emergency::TeamStatus parseTeamStatus(const std::string& s) {
    if (s == "BUSY") return emergency::TeamStatus::BUSY;
    if (s == "OFFLINE") return emergency::TeamStatus::OFFLINE;
    return emergency::TeamStatus::AVAILABLE;
}

std::string teamStatusToString(emergency::TeamStatus s) {
    switch (s) {
        case emergency::TeamStatus::BUSY: return "BUSY";
        case emergency::TeamStatus::OFFLINE: return "OFFLINE";
        case emergency::TeamStatus::AVAILABLE: default: return "AVAILABLE";
    }
}

emergency::EmergencyType parseEmergencyType(const std::string& s) {
    if (s == "FIRE") return emergency::EmergencyType::FIRE;
    if (s == "MEDICAL") return emergency::EmergencyType::MEDICAL;
    if (s == "FLOOD") return emergency::EmergencyType::FLOOD;
    if (s == "BUILDING_COLLAPSE") return emergency::EmergencyType::BUILDING_COLLAPSE;
    return emergency::EmergencyType::ACCIDENT;
}

std::string emergencyTypeToString(emergency::EmergencyType t) {
    switch (t) {
        case emergency::EmergencyType::FIRE: return "FIRE";
        case emergency::EmergencyType::MEDICAL: return "MEDICAL";
        case emergency::EmergencyType::FLOOD: return "FLOOD";
        case emergency::EmergencyType::BUILDING_COLLAPSE: return "BUILDING_COLLAPSE";
        case emergency::EmergencyType::ACCIDENT: default: return "ACCIDENT";
    }
}

emergency::EmergencyPriority parsePriority(const std::string& s) {
    if (s == "CRITICAL") return emergency::EmergencyPriority::CRITICAL;
    if (s == "HIGH") return emergency::EmergencyPriority::HIGH;
    if (s == "MEDIUM") return emergency::EmergencyPriority::MEDIUM;
    return emergency::EmergencyPriority::LOW;
}

std::string priorityToString(emergency::EmergencyPriority p) {
    switch (p) {
        case emergency::EmergencyPriority::CRITICAL: return "CRITICAL";
        case emergency::EmergencyPriority::HIGH: return "HIGH";
        case emergency::EmergencyPriority::MEDIUM: return "MEDIUM";
        case emergency::EmergencyPriority::LOW: default: return "LOW";
    }
}

std::string emergencyStatusToString(emergency::EmergencyStatus s) {
    switch (s) {
        case emergency::EmergencyStatus::ASSIGNED: return "ASSIGNED";
        case emergency::EmergencyStatus::IN_PROGRESS: return "IN_PROGRESS";
        case emergency::EmergencyStatus::COMPLETED: return "COMPLETED";
        case emergency::EmergencyStatus::CANCELLED: return "CANCELLED";
        case emergency::EmergencyStatus::PENDING: default: return "PENDING";
    }
}

std::string assignmentStatusToString(emergency::AssignmentStatus s) {
    switch (s) {
        case emergency::AssignmentStatus::ACCEPTED: return "ACCEPTED";
        case emergency::AssignmentStatus::COMPLETED: return "COMPLETED";
        case emergency::AssignmentStatus::DECLINED: return "DECLINED";
        case emergency::AssignmentStatus::CANCELLED: return "CANCELLED";
        case emergency::AssignmentStatus::REASSIGNMENT_REQUIRED: return "REASSIGNMENT_REQUIRED";
        case emergency::AssignmentStatus::OFFERED: default: return "OFFERED";
    }
}

std::string escapeJson(const std::string& s) {
    std::string res;
    for (char c : s) {
        if (c == '"') res += "\\\"";
        else if (c == '\\') res += "\\\\";
        else if (c == '\n') res += "\\n";
        else if (c == '\r') res += "\\r";
        else if (c == '\t') res += "\\t";
        else res += c;
    }
    return res;
}

std::string attachReqId(std::string jsonStr, const std::string& reqId) {
    if (reqId.empty()) {
        if (jsonStr.empty() || jsonStr.back() != '\n') jsonStr += '\n';
        return jsonStr;
    }
    while (!jsonStr.empty() && (jsonStr.back() == '\n' || jsonStr.back() == '\r')) {
        jsonStr.pop_back();
    }
    if (!jsonStr.empty() && jsonStr.back() == '}') {
        jsonStr.pop_back();
    }
    return jsonStr + ",\"requestId\":\"" + escapeJson(reqId) + "\"}\n";
}

void sendResponse(const std::string& jsonStr, const std::string& reqId) {
    std::cout << attachReqId(jsonStr, reqId) << std::flush;
}

int runIpc() {
    std::ios_base::sync_with_stdio(false);
    std::cin.tie(nullptr);

    emergency::EmergencyEngine engine;

    std::string line;
    while (std::getline(std::cin, line)) {
        line = trim(line);
        if (line.empty()) continue;

        std::string reqId = extractString(line, "requestId");
        std::string cmd = extractString(line, "cmd");
        if (cmd.empty()) {
            sendResponse("{\"success\":false,\"error\":\"Missing cmd property\"}", reqId);
            continue;
        }

        if (cmd == "ADD_NODE") {
            std::string id = extractString(line, "id");
            double lat = extractDouble(line, "lat");
            double lon = extractDouble(line, "lon");
            bool ok = engine.addGraphNode(id, {lat, lon});
            sendResponse("{\"success\":" + std::string(ok ? "true" : "false") + ",\"cmd\":\"ADD_NODE\",\"id\":\"" + escapeJson(id) + "\"}", reqId);
        }
        else if (cmd == "ADD_ROAD") {
            std::string id = extractString(line, "id");
            std::string u = extractString(line, "u");
            std::string v = extractString(line, "v");
            double dist = extractDouble(line, "distanceKm");
            bool ok = engine.addRoad({id, u, v, dist, emergency::RoadStatus::OPEN});
            sendResponse("{\"success\":" + std::string(ok ? "true" : "false") + ",\"cmd\":\"ADD_ROAD\",\"id\":\"" + escapeJson(id) + "\"}", reqId);
        }
        else if (cmd == "ADD_TEAM") {
            emergency::ResponseTeam team;
            team.id = extractString(line, "id");
            team.type = parseTeamType(extractString(line, "type"));
            team.status = parseTeamStatus(extractString(line, "status"));
            team.currentGraphNodeId = extractString(line, "nodeId");
            team.currentLocation = {extractDouble(line, "lat"), extractDouble(line, "lon")};
            team.lastUpdatedAt = currentTimestamp();
            bool ok = engine.addTeam(team);
            sendResponse("{\"success\":" + std::string(ok ? "true" : "false") + ",\"cmd\":\"ADD_TEAM\",\"id\":\"" + escapeJson(team.id) + "\"}", reqId);
        }
        else if (cmd == "UPDATE_TEAM_STATUS") {
            std::string teamId = extractString(line, "teamId");
            emergency::TeamStatus status = parseTeamStatus(extractString(line, "status"));
            engine.submit(emergency::TeamStatusChanged{teamId, status, currentTimestamp()});
            auto results = engine.processAllPendingEvents();
            sendResponse("{\"success\":true,\"cmd\":\"UPDATE_TEAM_STATUS\",\"teamId\":\"" + escapeJson(teamId) + "\",\"eventCount\":" + std::to_string(results.size()) + "}", reqId);
        }
        else if (cmd == "UPDATE_TEAM_LOCATION") {
            std::string teamId = extractString(line, "teamId");
            std::string nodeId = extractString(line, "nodeId");
            double lat = extractDouble(line, "lat");
            double lon = extractDouble(line, "lon");
            engine.submit(emergency::TeamLocationUpdated{teamId, {lat, lon}, nodeId, currentTimestamp()});
            auto results = engine.processAllPendingEvents();
            sendResponse("{\"success\":true,\"cmd\":\"UPDATE_TEAM_LOCATION\",\"teamId\":\"" + escapeJson(teamId) + "\",\"eventCount\":" + std::to_string(results.size()) + "}", reqId);
        }
        else if (cmd == "REPORT_EMERGENCY") {
            emergency::Emergency em;
            em.id = extractString(line, "id");
            em.type = parseEmergencyType(extractString(line, "type"));
            em.priority = parsePriority(extractString(line, "priority"));
            em.destinationGraphNodeId = extractString(line, "nodeId");
            em.location = {extractDouble(line, "lat"), extractDouble(line, "lon")};
            em.injuredCount = extractInt(line, "injuredCount");
            em.severity = extractInt(line, "severity", 3);
            em.createdAt = currentTimestamp();
            em.updatedAt = em.createdAt;

            engine.submit(emergency::EmergencyReported{em});
            auto results = engine.processAllPendingEvents();

            std::stringstream ss;
            ss << "{\"success\":true,\"cmd\":\"REPORT_EMERGENCY\",\"id\":\"" << escapeJson(em.id) << "\",\"notifications\":[";
            bool first = true;
            for (const auto& res : results) {
                for (const auto& note : res.notifications) {
                    if (!first) ss << ",";
                    ss << "\"" << escapeJson(note) << "\"";
                    first = false;
                }
            }
            ss << "]";
            
            for (const auto& res : results) {
                if (res.allocation && res.allocation->allocated) {
                    ss << ",\"allocatedTeamId\":\"" << escapeJson(res.allocation->teamId) << "\"";
                    ss << ",\"distanceKm\":" << res.allocation->distanceKm;
                }
                if (res.route) {
                    ss << ",\"route\":{\"totalDistanceKm\":" << res.route->totalDistanceKm << ",\"nodeIds\":[";
                    for (size_t i = 0; i < res.route->nodeIds.size(); ++i) {
                        if (i > 0) ss << ",";
                        ss << "\"" << escapeJson(res.route->nodeIds[i]) << "\"";
                    }
                    ss << "]}";
                }
            }
            ss << "}";
            sendResponse(ss.str(), reqId);
        }
        else if (cmd == "SET_ROAD_STATUS") {
            std::string roadId = extractString(line, "roadId");
            std::string statusStr = extractString(line, "status");
            emergency::RoadStatus status = (statusStr == "BLOCKED") ? emergency::RoadStatus::BLOCKED : emergency::RoadStatus::OPEN;
            
            engine.submit(emergency::RoadStatusChanged{roadId, status, currentTimestamp()});
            auto results = engine.processAllPendingEvents();

            std::stringstream ss;
            ss << "{\"success\":true,\"cmd\":\"SET_ROAD_STATUS\",\"roadId\":\"" << escapeJson(roadId) << "\",\"status\":\"" << statusStr << "\"";
            ss << ",\"notifications\":[";
            bool first = true;
            for (const auto& res : results) {
                for (const auto& note : res.notifications) {
                    if (!first) ss << ",";
                    ss << "\"" << escapeJson(note) << "\"";
                    first = false;
                }
            }
            ss << "]";
            for (const auto& res : results) {
                if (res.route) {
                    ss << ",\"reroute\":{\"status\":\"" << (res.route->status == emergency::RouteStatus::AVAILABLE ? "AVAILABLE" : "UNREACHABLE") << "\"";
                    ss << ",\"totalDistanceKm\":" << res.route->totalDistanceKm << ",\"nodeIds\":[";
                    for (size_t i = 0; i < res.route->nodeIds.size(); ++i) {
                        if (i > 0) ss << ",";
                        ss << "\"" << escapeJson(res.route->nodeIds[i]) << "\"";
                    }
                    ss << "]}";
                }
            }
            ss << "}";
            sendResponse(ss.str(), reqId);
        }
        else if (cmd == "ACCEPT_ASSIGNMENT") {
            std::string asgId = extractString(line, "assignmentId");
            engine.submit(emergency::AssignmentAccepted{asgId, currentTimestamp()});
            auto results = engine.processAllPendingEvents();
            sendResponse("{\"success\":true,\"cmd\":\"ACCEPT_ASSIGNMENT\",\"assignmentId\":\"" + escapeJson(asgId) + "\"}", reqId);
        }
        else if (cmd == "DECLINE_ASSIGNMENT") {
            std::string asgId = extractString(line, "assignmentId");
            engine.submit(emergency::AssignmentDeclined{asgId, currentTimestamp()});
            auto results = engine.processAllPendingEvents();
            sendResponse("{\"success\":true,\"cmd\":\"DECLINE_ASSIGNMENT\",\"assignmentId\":\"" + escapeJson(asgId) + "\"}", reqId);
        }
        else if (cmd == "COMPLETE_EMERGENCY") {
            std::string emId = extractString(line, "emergencyId");
            engine.submit(emergency::EmergencyCompleted{emId, currentTimestamp()});
            auto results = engine.processAllPendingEvents();
            sendResponse("{\"success\":true,\"cmd\":\"COMPLETE_EMERGENCY\",\"emergencyId\":\"" + escapeJson(emId) + "\"}", reqId);
        }
        else if (cmd == "GET_SNAPSHOT") {
            const auto& state = engine.getSnapshot();
            std::stringstream ss;
            ss << "{\"success\":true,\"cmd\":\"GET_SNAPSHOT\"";

            // Teams
            ss << ",\"teams\":[";
            bool first = true;
            state.teamsById.forEach([&](const std::string&, const emergency::ResponseTeam& t) {
                if (!first) ss << ",";
                ss << "{\"id\":\"" << escapeJson(t.id) << "\",\"type\":\"" << teamTypeToString(t.type)
                   << "\",\"status\":\"" << teamStatusToString(t.status)
                   << "\",\"nodeId\":\"" << escapeJson(t.currentGraphNodeId)
                   << "\",\"activeAssignmentId\":\"" << escapeJson(t.activeAssignmentId)
                   << "\",\"lat\":" << t.currentLocation.latitude << ",\"lon\":" << t.currentLocation.longitude << "}";
                first = false;
            });
            ss << "]";

            // Emergencies
            ss << ",\"emergencies\":[";
            first = true;
            state.emergenciesById.forEach([&](const std::string&, const emergency::Emergency& em) {
                if (!first) ss << ",";
                ss << "{\"id\":\"" << escapeJson(em.id) << "\",\"type\":\"" << emergencyTypeToString(em.type)
                   << "\",\"priority\":\"" << priorityToString(em.priority)
                   << "\",\"status\":\"" << emergencyStatusToString(em.status)
                   << "\",\"nodeId\":\"" << escapeJson(em.destinationGraphNodeId)
                   << "\",\"injured\":" << em.injuredCount
                   << ",\"severity\":" << em.severity
                   << ",\"lat\":" << em.location.latitude << ",\"lon\":" << em.location.longitude << "}";
                first = false;
            });
            ss << "]";

            // Roads
            ss << ",\"roads\":[";
            first = true;
            state.cityGraph.forEachRoad([&](const emergency::Road& r) {
                if (!first) ss << ",";
                ss << "{\"id\":\"" << escapeJson(r.id) << "\",\"u\":\"" << escapeJson(r.fromNodeId)
                   << "\",\"v\":\"" << escapeJson(r.toNodeId)
                   << "\",\"distanceKm\":" << r.weightKm
                   << ",\"status\":\"" << (r.status == emergency::RoadStatus::BLOCKED ? "BLOCKED" : "OPEN") << "\"}";
                first = false;
            });
            ss << "]";

            // Nodes
            ss << ",\"nodes\":[";
            first = true;
            state.cityGraph.forEachNode([&](const emergency::GraphVertex& n) {
                if (!first) ss << ",";
                ss << "{\"id\":\"" << escapeJson(n.id) << "\",\"lat\":" << n.point.latitude << ",\"lon\":" << n.point.longitude << "}";
                first = false;
            });
            ss << "]";

            // Assignments
            ss << ",\"assignments\":[";
            first = true;
            state.assignmentsById.forEach([&](const std::string&, const emergency::Assignment& a) {
                if (!first) ss << ",";
                ss << "{\"id\":\"" << escapeJson(a.id) << "\",\"emergencyId\":\"" << escapeJson(a.emergencyId)
                   << "\",\"teamId\":\"" << escapeJson(a.teamId)
                   << "\",\"status\":\"" << assignmentStatusToString(a.status) << "\""
                   << ",\"routeDistanceKm\":" << a.latestRoute.totalDistanceKm
                   << ",\"routeNodes\":[";
                for (size_t j = 0; j < a.latestRoute.nodeIds.size(); ++j) {
                    if (j > 0) ss << ",";
                    ss << "\"" << escapeJson(a.latestRoute.nodeIds[j]) << "\"";
                }
                ss << "]}";
                first = false;
            });
            ss << "]";

            ss << "}";
            sendResponse(ss.str(), reqId);
        }
        else {
            sendResponse("{\"success\":false,\"error\":\"Unknown command: " + escapeJson(cmd) + "\"}", reqId);
        }
    }
    return 0;
}

}  // namespace

int main(int argc, char* argv[]) {
    if (argc > 1 && std::string(argv[1]) == "--ipc") {
        return runIpc();
    }

    // Default console demonstration
    using namespace emergency;
    EmergencyEngine engine;
    engine.addGraphNode("Station", {}); engine.addGraphNode("Incident", {});
    engine.addRoad({"R1", "Station", "Incident", 2.5});
    ResponseTeam team; team.id = "A01"; team.type = TeamType::AMBULANCE; team.status = TeamStatus::AVAILABLE; team.currentGraphNodeId = "Station"; team.currentLocation = {18.5200, 73.8560};
    engine.addTeam(team);
    Emergency item; item.id = "E101"; item.type = EmergencyType::ACCIDENT; item.priority = EmergencyPriority::CRITICAL; item.location = {18.5210, 73.8570}; item.destinationGraphNodeId = "Incident"; item.createdAt = 1; item.updatedAt = 1;
    engine.submit(EmergencyReported{item});
    const EngineResult result = engine.processNextEvent();
    for (const auto& note : result.notifications) std::cout << note << '\n';
    if (result.route) std::cout << "Route distance: " << result.route->totalDistanceKm << " km\n";
    return result.success ? 0 : 1;
}

