#include "engine/emergency_engine.hpp"
#include "test_support.hpp"

namespace {
using namespace emergency;

Emergency accident(const std::string& id, EmergencyPriority priority, std::int64_t createdAt, const std::string& destination = "D") {
    Emergency item; item.id = id; item.type = EmergencyType::ACCIDENT; item.priority = priority; item.createdAt = createdAt; item.updatedAt = createdAt;
    item.location = {18.5204, 73.8567}; item.destinationGraphNodeId = destination; return item;
}
ResponseTeam ambulance(const std::string& id, TeamStatus status, double latitude, double longitude, const std::string& node) {
    ResponseTeam team; team.id = id; team.type = TeamType::AMBULANCE; team.status = status; team.currentLocation = {latitude, longitude}; team.currentGraphNodeId = node; return team;
}
void addRerouteGraph(EmergencyEngine& engine) {
    for (const char* id : {"A", "B", "C", "D", "E", "F"}) require(engine.addGraphNode(id, {}), "add graph node");
    require(engine.addRoad({"AB", "A", "B", 1}), "AB"); require(engine.addRoad({"BC", "B", "C", 1}), "BC"); require(engine.addRoad({"CD", "C", "D", 1}), "CD");
    require(engine.addRoad({"CE", "C", "E", 1}), "CE"); require(engine.addRoad({"EF", "E", "F", 1}), "EF"); require(engine.addRoad({"FD", "F", "D", 1}), "FD");
}

void tests() {
    { // nearest compatible AVAILABLE unit is selected; busy and offline units are excluded.
        EmergencyEngine engine; addRerouteGraph(engine);
        require(engine.addTeam(ambulance("A01", TeamStatus::AVAILABLE, 18.5200, 73.8560, "A")), "add A01");
        require(engine.addTeam(ambulance("A02", TeamStatus::BUSY, 18.5203, 73.8565, "B")), "add A02");
        require(engine.addTeam(ambulance("A03", TeamStatus::OFFLINE, 18.5203, 73.8565, "C")), "add A03");
        engine.submit(EmergencyReported{accident("E1", EmergencyPriority::HIGH, 1)});
        const auto result = engine.processNextEvent();
        require(result.success && result.allocation && result.allocation->teamId == "A01", "only available ambulance selected");
        require(engine.getEmergency("E1")->status == EmergencyStatus::ASSIGNED, "emergency assigned");
        require(engine.getTeam("A01")->status == TeamStatus::BUSY, "team reserved as busy");
    }
    { // no unit leaves the incident queued and pending.
        EmergencyEngine engine; addRerouteGraph(engine);
        engine.submit(EmergencyReported{accident("E2", EmergencyPriority::CRITICAL, 2)});
        engine.processNextEvent();
        require(engine.getEmergency("E2")->status == EmergencyStatus::PENDING, "no-resource emergency remains pending");
        require(engine.getSnapshot().pendingEmergencyHeap.size() == 1, "pending emergency remains in heap");
    }
    { // road blockage reroutes from the latest graph node, not original origin.
        EmergencyEngine engine; addRerouteGraph(engine);
        require(engine.addTeam(ambulance("A01", TeamStatus::AVAILABLE, 18.5200, 73.8560, "A")), "add team");
        engine.submit(EmergencyReported{accident("E3", EmergencyPriority::CRITICAL, 3)}); engine.processNextEvent();
        engine.submit(TeamLocationUpdated{"A01", {18.5202, 73.8564}, "C", 4}); engine.processNextEvent();
        engine.submit(RoadStatusChanged{"CD", RoadStatus::BLOCKED, 5});
        const auto reroute = engine.processNextEvent();
        const Assignment* assignment = engine.getAssignment("ASG-1");
        require(reroute.success && assignment->latestRoute.status == RouteStatus::AVAILABLE, "reroute succeeds");
        require(assignment->latestRoute.nodeIds.front() == "C", "reroute starts at latest node");
        require(assignment->latestRoute.nodeIds.size() == 4 && assignment->latestRoute.nodeIds[1] == "E", "reroute uses alternative path");
        require(assignment->routeRevisionStack.size() == 2 && assignment->routeRevisionHistory.size() == 2, "route revision structures updated");
    }
    { // a failed busy team permits reallocation; completion releases teams and retries pending work.
        EmergencyEngine engine; addRerouteGraph(engine);
        require(engine.addTeam(ambulance("A01", TeamStatus::AVAILABLE, 18.5200, 73.8560, "A")), "add first team");
        require(engine.addTeam(ambulance("A02", TeamStatus::AVAILABLE, 18.5300, 73.8660, "B")), "add second team");
        engine.submit(EmergencyReported{accident("E4", EmergencyPriority::HIGH, 6)}); engine.processNextEvent();
        engine.submit(TeamStatusChanged{"A01", TeamStatus::OFFLINE, 7}); engine.processNextEvent();
        require(engine.getEmergency("E4")->status == EmergencyStatus::ASSIGNED, "failed-team emergency reallocated");
        require(engine.getTeam("A02")->activeAssignmentId == "ASG-2", "second team receives reassignment");
        engine.submit(AssignmentAccepted{"ASG-2", 8}); engine.processNextEvent();
        engine.submit(EmergencyCompleted{"E4", 9}); engine.processNextEvent();
        require(engine.getEmergency("E4")->status == EmergencyStatus::COMPLETED && engine.getTeam("A02")->status == TeamStatus::AVAILABLE, "completion restores availability");
    }
}
}

int main() { return runTests("engine_tests", tests); }
