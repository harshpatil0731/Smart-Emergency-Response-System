#pragma once

#include "domain/enums.hpp"

namespace emergency {

class ResourceCompatibility {
public:
    static bool isCompatible(EmergencyType emergencyType, TeamType teamType) {
        switch (emergencyType) {
            case EmergencyType::ACCIDENT:
            case EmergencyType::MEDICAL:
            case EmergencyType::OTHER: return teamType == TeamType::AMBULANCE;
            case EmergencyType::FIRE: return teamType == TeamType::FIRE_BRIGADE;
            case EmergencyType::FLOOD:
            case EmergencyType::BUILDING_COLLAPSE: return teamType == TeamType::RESCUE_TEAM;
        }
        return false;
    }
};

}  // namespace emergency
