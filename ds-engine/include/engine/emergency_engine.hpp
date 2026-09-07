#pragma once

#include <optional>
#include <string>
#include "domain/domain_event.hpp"
#include "domain/road.hpp"
#include "domain/response_team.hpp"
#include "engine/engine_result.hpp"
#include "engine/engine_state.hpp"
#include "services/resource_allocator.hpp"
#include "services/route_planner.hpp"

namespace emergency {

// Transport-neutral application façade. A later NDJSON adapter will call only this class.
class EmergencyEngine {
public:
    bool addTeam(const ResponseTeam& team);
    bool addGraphNode(const std::string& nodeId, GeoPoint point);
    bool addRoad(const Road& road);

    void submit(const DomainEvent& event);
    [[nodiscard]] EngineResult processNextEvent();
    [[nodiscard]] std::vector<EngineResult> processAllPendingEvents();

    [[nodiscard]] const EngineState& getSnapshot() const { return state_; }
    [[nodiscard]] const Emergency* getEmergency(const std::string& id) const { return state_.emergenciesById.find(id); }
    [[nodiscard]] const ResponseTeam* getTeam(const std::string& id) const { return state_.teamsById.find(id); }
    [[nodiscard]] const Assignment* getAssignment(const std::string& id) const { return state_.assignmentsById.find(id); }

private:
    EngineState state_;
    ResourceAllocator allocator_;
    RoutePlanner routePlanner_;
    std::size_t assignmentSequence_{};

    EngineResult handle(const DomainEvent& event);
    EngineResult reportEmergency(Emergency emergency);
    void attemptAllocation(const std::string& emergencyId, EngineResult& result);
    void retryPendingEmergencies(EngineResult& result);
    void addRouteRevision(Assignment& assignment, const RouteResult& route, const std::string& reason, std::int64_t timestamp);
    void record(std::int64_t timestamp, const std::string& message);
    [[nodiscard]] std::string nextAssignmentId();
};

}  // namespace emergency
