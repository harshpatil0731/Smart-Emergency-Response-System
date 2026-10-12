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
    { // when the nearest driver declines, the system assigns to the second-nearest eligible driver;
      // if all decline, emergency remains pending; declining driver remains available for other incidents;
      // duplicate decline events are handled idempotently.
        EmergencyEngine engine; addRerouteGraph(engine);
        // A01 is nearest to emergency location (18.5204, 73.8567) at (18.5204, 73.8566)
        // A02 is second nearest at (18.5210, 73.8570)
        require(engine.addTeam(ambulance("A01", TeamStatus::AVAILABLE, 18.5204, 73.8566, "A")), "add A01");
        require(engine.addTeam(ambulance("A02", TeamStatus::AVAILABLE, 18.5210, 73.8570, "B")), "add A02");

        // 1. Initial report: A01 is nearest and offered ASG-1
        engine.submit(EmergencyReported{accident("E5", EmergencyPriority::HIGH, 10)});
        const auto reportRes = engine.processNextEvent();
        require(reportRes.success && reportRes.allocation && reportRes.allocation->teamId == "A01", "A01 selected initially");
        require(reportRes.assignmentId == "ASG-1", "ASG-1 created");
        require(engine.getTeam("A01")->status == TeamStatus::BUSY, "A01 is busy");
        require(engine.getTeam("A01")->activeAssignmentId == "ASG-1", "A01 has ASG-1");

        // 2. A01 declines ASG-1
        engine.submit(AssignmentDeclined{"ASG-1", 11});
        const auto declineRes = engine.processNextEvent();
        require(declineRes.success, "decline event succeeded");
        require(engine.getAssignment("ASG-1")->status == AssignmentStatus::DECLINED, "ASG-1 marked declined");
        require(engine.getTeam("A01")->status == TeamStatus::AVAILABLE, "A01 restored to available");
        require(engine.getTeam("A01")->activeAssignmentId.empty(), "A01 active assignment cleared");
        require(engine.getEmergency("E5")->hasDeclined("A01"), "E5 records A01 declined");

        // Engine must select second-nearest A02 for E5, NOT A01!
        require(declineRes.allocation && declineRes.allocation->teamId == "A02", "second nearest A02 allocated after decline");
        require(engine.getTeam("A02")->status == TeamStatus::BUSY, "A02 is now busy");
        require(engine.getTeam("A02")->activeAssignmentId == "ASG-2", "A02 assigned ASG-2");
        require(engine.getEmergency("E5")->status == EmergencyStatus::ASSIGNED, "E5 reassigned to A02");

        // 3. Duplicate/idempotent decline of ASG-1
        engine.submit(AssignmentDeclined{"ASG-1", 12});
        const auto dupDeclineRes = engine.processNextEvent();
        require(dupDeclineRes.success, "duplicate decline is idempotent");

        // 4. A02 also declines ASG-2
        engine.submit(AssignmentDeclined{"ASG-2", 13});
        const auto secondDeclineRes = engine.processNextEvent();
        require(secondDeclineRes.success, "A02 decline succeeded");
        require(engine.getAssignment("ASG-2")->status == AssignmentStatus::DECLINED, "ASG-2 marked declined");
        require(engine.getTeam("A02")->status == TeamStatus::AVAILABLE, "A02 restored to available");
        require(engine.getEmergency("E5")->hasDeclined("A02"), "E5 records A02 declined");

        // Since both A01 and A02 declined E5, E5 must remain PENDING
        require(engine.getEmergency("E5")->status == EmergencyStatus::PENDING, "E5 remains pending when all decline");
        require(engine.getSnapshot().pendingEmergencyHeap.size() == 1, "E5 is queued in pending heap");

        // 5. Declining drivers A01 and A02 remain eligible for OTHER emergencies
        engine.submit(EmergencyReported{accident("E6", EmergencyPriority::HIGH, 14)});
        const auto e6Res = engine.processNextEvent();
        require(e6Res.success && e6Res.allocation && e6Res.allocation->teamId == "A01", "A01 eligible and selected for new emergency E6");
        require(engine.getTeam("A01")->status == TeamStatus::BUSY, "A01 is busy with E6");
        require(!engine.getEmergency("E6")->hasDeclined("A01"), "E6 has not been declined by A01");
    }
}
}

int main() { return runTests("engine_tests", tests); }
