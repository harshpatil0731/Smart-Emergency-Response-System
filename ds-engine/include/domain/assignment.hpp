#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "domain/enums.hpp"
#include "structures/linked_list.hpp"
#include "structures/stack.hpp"

namespace emergency {

struct RouteRevision {
    int revision{};
    RouteStatus status{RouteStatus::UNREACHABLE};
    std::vector<std::string> nodeIds;
    std::vector<std::string> roadIds;
    double totalDistanceKm{};
    std::string reason;
    std::int64_t createdAt{};
};

struct Assignment {
    std::string id;
    std::string emergencyId;
    std::string teamId;
    AssignmentStatus status{AssignmentStatus::OFFERED};
    RouteStatus routeStatus{RouteStatus::UNREACHABLE};
    RouteRevision latestRoute{};
    Stack<RouteRevision> routeRevisionStack;
    LinkedList<RouteRevision> routeRevisionHistory;
    std::int64_t assignedAt{};
    std::int64_t acceptedAt{};
    std::int64_t completedAt{};
};

}  // namespace emergency
