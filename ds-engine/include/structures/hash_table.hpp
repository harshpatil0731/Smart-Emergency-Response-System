#pragma once

#include <cstddef>
#include <functional>
#include <utility>
#include <vector>
#include "structures/linked_list.hpp"

namespace emergency {

// Separate-chaining hash table. Buckets are custom linked lists, not std::unordered_map.
template <typename K, typename V, typename Hasher = std::hash<K>, typename Equal = std::equal_to<K>>
class HashTable {
public:
    explicit HashTable(std::size_t bucketCount = 97) : buckets_(bucketCount == 0 ? 1 : bucketCount) {}
    bool insert(const K& key, const V& value) { if (contains(key)) return false; buckets_[index(key)].pushBack({key, value}); ++size_; return true; }
    void upsert(const K& key, const V& value) { if (auto* entry = entryFor(key)) entry->value = value; else { buckets_[index(key)].pushBack({key, value}); ++size_; } }
    [[nodiscard]] V* find(const K& key) { auto* entry = entryFor(key); return entry ? &entry->value : nullptr; }
    [[nodiscard]] const V* find(const K& key) const { auto* entry = entryFor(key); return entry ? &entry->value : nullptr; }
    bool erase(const K& key) { bool removed = buckets_[index(key)].removeFirst([&](const Entry& e) { return equal_(e.key, key); }); if (removed) --size_; return removed; }
    [[nodiscard]] bool contains(const K& key) const { return entryFor(key) != nullptr; }
    template <typename Visitor> void forEach(Visitor visitor) { for (auto& bucket : buckets_) bucket.forEach([&](Entry& e) { visitor(e.key, e.value); }); }
    template <typename Visitor> void forEach(Visitor visitor) const { for (const auto& bucket : buckets_) bucket.forEach([&](const Entry& e) { visitor(e.key, e.value); }); }
    [[nodiscard]] std::size_t size() const { return size_; }
private:
    struct Entry { K key; V value; };
    std::vector<LinkedList<Entry>> buckets_; std::size_t size_{}; Hasher hasher_{}; Equal equal_{};
    [[nodiscard]] std::size_t index(const K& key) const { return hasher_(key) % buckets_.size(); }
    Entry* entryFor(const K& key) { return buckets_[index(key)].find([&](const Entry& e) { return equal_(e.key, key); }); }
    const Entry* entryFor(const K& key) const { return buckets_[index(key)].find([&](const Entry& e) { return equal_(e.key, key); }); }
};

}  // namespace emergency
