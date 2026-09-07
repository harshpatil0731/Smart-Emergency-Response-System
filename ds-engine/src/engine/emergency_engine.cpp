#include "engine/emergency_engine.hpp"

#include <algorithm>
#include <sstream>
#include <type_traits>

namespace emergency {

bool EmergencyEngine::addTeam(const ResponseTeam& team) {
    return !team.id.empty() && state_.teamsById.insert(team.id, team);
}
bool EmergencyEngine::addGraphNode(const std::string& nodeId, GeoPoint point) { return state_.cityGraph.addNode(nodeId, point); }
bool EmergencyEngine::addRoad(const Road& road) { return state_.cityGraph.addRoad(road); }
void EmergencyEngine::submit(const DomainEvent& event) { state_.incomingEventQueue.enqueue(event); }

EngineResult EmergencyEngine::processNextEvent() {
    const auto event = state_.incomingEventQueue.dequeue();
    if (!event) return {};
    return handle(*event);
}

std::vector<EngineResult> EmergencyEngine::processAllPendingEvents() {
    std::vector<EngineResult> results;
    while (!state_.incomingEventQueue.empty()) results.push_back(processNextEvent());
    return results;
}

EngineResult EmergencyEngine::handle(const DomainEvent& event) {
    return std::visit([this](const auto& value) -> EngineResult {
        using Event = std::decay_t<decltype(value)>;
        if constexpr (std::is_same_v<Event, EmergencyReported>) {
            return reportEmergency(value.emergency);
        } else if constexpr (std::is_same_v<Event, TeamLocationUpdated>) {
            EngineResult result;
            ResponseTeam* team = state_.teamsById.find(value.teamId);
            if (!team) { result.success = false; result.error = "Response team not found"; return result; }
            team->currentLocation = value.location; team->currentGraphNodeId = value.graphNodeId; team->lastUpdatedAt = value.timestamp;
            record(value.timestamp, "Location updated for " + team->id);
            result.notifications.push_back("Team location updated: " + team->id);
            return result;
        } else if constexpr (std::is_same_v<Event, TeamStatusChanged>) {
            EngineResult result;
            ResponseTeam* team = state_.teamsById.find(value.teamId);
            if (!team) { result.success = false; result.error = "Response team not found"; return result; }
            const TeamStatus previous = team->status;
            team->status = value.status; team->lastUpdatedAt = value.timestamp;
            record(value.timestamp, "Status updated for " + team->id);
            if (previous == TeamStatus::BUSY && value.status == TeamStatus::OFFLINE && !team->activeAssignmentId.empty()) {
                Assignment* assignment = state_.assignmentsById.find(team->activeAssignmentId);
                if (assignment) {
                    assignment->status = AssignmentStatus::REASSIGNMENT_REQUIRED;
                    Emergency* emergency = state_.emergenciesById.find(assignment->emergencyId);
                    if (emergency && emergency->status != EmergencyStatus::COMPLETED && emergency->status != EmergencyStatus::CANCELLED) {
                        emergency->status = EmergencyStatus::PENDING;
                        emergency->updatedAt = value.timestamp;
                        state_.pendingEmergencyHeap.requeue(*emergency);
                    }
                }
                team->activeAssignmentId.clear();
                result.notifications.push_back("Busy team went offline; active emergency returned to pending queue");
            }
            if (value.status == TeamStatus::AVAILABLE || previous == TeamStatus::BUSY && value.status == TeamStatus::OFFLINE) retryPendingEmergencies(result);
            return result;
        } else if constexpr (std::is_same_v<Event, RoadStatusChanged>) {
            EngineResult result;
            if (!state_.cityGraph.setRoadStatus(value.roadId, value.status)) { result.success = false; result.error = "Road not found"; return result; }
            record(value.timestamp, "Road status updated: " + value.roadId);
            result.notifications.push_back("Road status updated: " + value.roadId);
            if (value.status == RoadStatus::BLOCKED) {
                state_.assignmentsById.forEach([&](const std::string&, Assignment& assignment) {
                    if (assignment.status != AssignmentStatus::OFFERED && assignment.status != AssignmentStatus::ACCEPTED) return;
                    if (std::find(assignment.latestRoute.roadIds.begin(), assignment.latestRoute.roadIds.end(), value.roadId) == assignment.latestRoute.roadIds.end()) return;
                    ResponseTeam* team = state_.teamsById.find(assignment.teamId);
                    Emergency* emergency = state_.emergenciesById.find(assignment.emergencyId);
                    if (!team || !emergency) return;
                    const RouteResult route = routePlanner_.reroute(state_.cityGraph, team->currentGraphNodeId, emergency->destinationGraphNodeId);
                    addRouteRevision(assignment, route, "road blocked: " + value.roadId, value.timestamp);
                    result.route = route;
                    result.notifications.push_back(route.status == RouteStatus::AVAILABLE ? "Route recalculated for " + team->id : "No route available for " + team->id);
                });
            }
            return result;
        } else if constexpr (std::is_same_v<Event, AssignmentAccepted>) {
            EngineResult result;
            Assignment* assignment = state_.assignmentsById.find(value.assignmentId);
            if (!assignment || assignment->status != AssignmentStatus::OFFERED) { result.success = false; result.error = "Offer not found or not pending acceptance"; return result; }
            assignment->status = AssignmentStatus::ACCEPTED; assignment->acceptedAt = value.timestamp;
            if (Emergency* emergency = state_.emergenciesById.find(assignment->emergencyId)) { emergency->status = EmergencyStatus::IN_PROGRESS; emergency->updatedAt = value.timestamp; }
            record(value.timestamp, "Assignment accepted: " + assignment->id);
            result.notifications.push_back("Assignment accepted: " + assignment->id);
            return result;
        } else if constexpr (std::is_same_v<Event, AssignmentDeclined>) {
            EngineResult result;
            Assignment* assignment = state_.assignmentsById.find(value.assignmentId);
            if (!assignment || assignment->status != AssignmentStatus::OFFERED) { result.success = false; result.error = "Offer not found or not pending acceptance"; return result; }
            assignment->status = AssignmentStatus::DECLINED;
            if (ResponseTeam* team = state_.teamsById.find(assignment->teamId)) { team->activeAssignmentId.clear(); if (team->status != TeamStatus::OFFLINE) team->status = TeamStatus::AVAILABLE; }
            if (Emergency* emergency = state_.emergenciesById.find(assignment->emergencyId)) { emergency->status = EmergencyStatus::PENDING; emergency->updatedAt = value.timestamp; state_.pendingEmergencyHeap.requeue(*emergency); }
            record(value.timestamp, "Assignment declined: " + assignment->id);
            retryPendingEmergencies(result);
            return result;
        } else {  // EmergencyCompleted
            EngineResult result;
            Emergency* emergency = state_.emergenciesById.find(value.emergencyId);
            if (!emergency) { result.success = false; result.error = "Emergency not found"; return result; }
            if (emergency->status == EmergencyStatus::COMPLETED || emergency->status == EmergencyStatus::CANCELLED) { result.success = false; result.error = "Emergency is already closed"; return result; }
            emergency->status = EmergencyStatus::COMPLETED; emergency->updatedAt = value.timestamp;
            state_.assignmentsById.forEach([&](const std::string&, Assignment& assignment) {
                if (assignment.emergencyId != emergency->id || assignment.status == AssignmentStatus::DECLINED || assignment.status == AssignmentStatus::REASSIGNMENT_REQUIRED) return;
                assignment.status = AssignmentStatus::COMPLETED; assignment.completedAt = value.timestamp;
                if (ResponseTeam* team = state_.teamsById.find(assignment.teamId)) { team->activeAssignmentId.clear(); if (team->status != TeamStatus::OFFLINE) team->status = TeamStatus::AVAILABLE; }
            });
            record(value.timestamp, "Emergency completed: " + emergency->id);
            result.notifications.push_back("Emergency completed: " + emergency->id);
            retryPendingEmergencies(result);
            return result;
        }
    }, event);
}

EngineResult EmergencyEngine::reportEmergency(Emergency emergency) {
    EngineResult result;
    if (emergency.id.empty() || state_.emergenciesById.contains(emergency.id)) { result.success = false; result.error = "Emergency ID is missing or duplicated"; return result; }
    emergency.status = EmergencyStatus::PENDING;
    state_.emergenciesById.insert(emergency.id, emergency);
    state_.pendingEmergencyHeap.enqueue(emergency);
    record(emergency.createdAt, "Emergency reported: " + emergency.id);
    result.notifications.push_back("Emergency queued: " + emergency.id);
    retryPendingEmergencies(result);
    return result;
}

void EmergencyEngine::attemptAllocation(const std::string& emergencyId, EngineResult& result) {
    Emergency* emergency = state_.emergenciesById.find(emergencyId);
    if (!emergency || emergency->status != EmergencyStatus::PENDING) return;
    const AllocationDecision decision = allocator_.selectNearestAvailableTeam(*emergency, state_.teamsById);
    result.allocation = decision;
    if (!decision.allocated) return;
    ResponseTeam* team = state_.teamsById.find(decision.teamId);
    if (!team) return;
    Assignment assignment; assignment.id = nextAssignmentId(); assignment.emergencyId = emergency->id; assignment.teamId = team->id; assignment.assignedAt = emergency->updatedAt;
    const RouteResult route = routePlanner_.createRoute(state_.cityGraph, team->currentGraphNodeId, emergency->destinationGraphNodeId);
    addRouteRevision(assignment, route, "initial route", emergency->updatedAt);
    state_.assignmentsById.insert(assignment.id, assignment);
    emergency->status = EmergencyStatus::ASSIGNED;
    team->status = TeamStatus::BUSY; team->activeAssignmentId = assignment.id;
    result.route = route;
    result.notifications.push_back("Team " + team->id + " offered assignment " + assignment.id);
}

void EmergencyEngine::retryPendingEmergencies(EngineResult& result) {
    const std::size_t attempts = state_.pendingEmergencyHeap.size();
    for (std::size_t index = 0; index < attempts; ++index) {
        const auto queued = state_.pendingEmergencyHeap.popNext();
        if (!queued) break;
        Emergency* current = state_.emergenciesById.find(queued->id);
        if (!current || current->status != EmergencyStatus::PENDING) continue;  // Lazy removal of stale heap entries.
        attemptAllocation(current->id, result);
        if (current->status == EmergencyStatus::PENDING) state_.pendingEmergencyHeap.requeue(*current);
    }
}

void EmergencyEngine::addRouteRevision(Assignment& assignment, const RouteResult& route, const std::string& reason, std::int64_t timestamp) {
    RouteRevision revision; revision.revision = static_cast<int>(assignment.routeRevisionStack.size()) + 1; revision.status = route.status;
    revision.nodeIds = route.nodeIds; revision.roadIds = route.roadIds; revision.totalDistanceKm = route.totalDistanceKm; revision.reason = reason; revision.createdAt = timestamp;
    assignment.routeStatus = route.status; assignment.latestRoute = revision; assignment.routeRevisionStack.push(revision); assignment.routeRevisionHistory.pushBack(revision);
}

void EmergencyEngine::record(std::int64_t timestamp, const std::string& message) { state_.emergencyHistory.pushBack({timestamp, message}); }
std::string EmergencyEngine::nextAssignmentId() { std::ostringstream id; id << "ASG-" << ++assignmentSequence_; return id.str(); }

}  // namespace emergency
