#pragma once

#include "domain/emergency.hpp"

namespace emergency {

class PriorityPolicy {
public:
    static int priorityRank(EmergencyPriority priority) {
        switch (priority) {
            case EmergencyPriority::CRITICAL: return 4;
            case EmergencyPriority::HIGH: return 3;
            case EmergencyPriority::MEDIUM: return 2;
            case EmergencyPriority::LOW: return 1;
        }
        return 0;
    }
    static bool comesBefore(const Emergency& a, const Emergency& b) {
        const int rankA = priorityRank(a.priority), rankB = priorityRank(b.priority);
        if (rankA != rankB) return rankA > rankB;
        if (a.createdAt != b.createdAt) return a.createdAt < b.createdAt;
        return a.id < b.id;
    }
};

}  // namespace emergency
