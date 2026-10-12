#pragma once

#include <cstdint>
#include <string>
#include "domain/enums.hpp"
#include "domain/geo_point.hpp"
#include "structures/linked_list.hpp"

namespace emergency {

struct Emergency {
    std::string id;
    EmergencyType type{EmergencyType::OTHER};
    EmergencyPriority priority{EmergencyPriority::LOW};
    int severity{};
    int injuredCount{};
    GeoPoint location{};
    std::string destinationGraphNodeId;
    EmergencyStatus status{EmergencyStatus::PENDING};
    std::int64_t createdAt{};
    std::int64_t updatedAt{};
    LinkedList<std::string> declinedTeamIds;

    [[nodiscard]] bool hasDeclined(const std::string& teamId) const {
        return declinedTeamIds.find([&teamId](const std::string& id) {
            return id == teamId;
        }) != nullptr;
    }

    void recordDecline(const std::string& teamId) {
        if (!hasDeclined(teamId)) {
            declinedTeamIds.pushBack(teamId);
        }
    }
};
}  // namespace emergency
