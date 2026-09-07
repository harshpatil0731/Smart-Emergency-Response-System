#pragma once

#include <cstddef>
#include <functional>
#include <optional>
#include <utility>

namespace emergency {

// Singly linked list used as the building block for history and hash buckets.
template <typename T>
class LinkedList {
public:
    LinkedList() = default;
    LinkedList(const LinkedList& other) { other.forEach([this](const T& value) { pushBack(value); }); }
    LinkedList& operator=(const LinkedList& other) { if (this != &other) { clear(); other.forEach([this](const T& value) { pushBack(value); }); } return *this; }
    LinkedList(LinkedList&& other) noexcept { swap(other); }
    LinkedList& operator=(LinkedList&& other) noexcept { clear(); swap(other); return *this; }
    ~LinkedList() { clear(); }

    void pushBack(const T& value) { append(new Node(value)); }
    void pushBack(T&& value) { append(new Node(std::move(value))); }
    void pushFront(const T& value) { head_ = new Node(value, head_); ++size_; }

    template <typename Predicate>
    T* find(Predicate predicate) {
        for (Node* current = head_; current != nullptr; current = current->next) if (predicate(current->value)) return &current->value;
        return nullptr;
    }
    template <typename Predicate>
    const T* find(Predicate predicate) const {
        for (const Node* current = head_; current != nullptr; current = current->next) if (predicate(current->value)) return &current->value;
        return nullptr;
    }
    template <typename Predicate>
    bool removeFirst(Predicate predicate) {
        Node* previous = nullptr;
        Node* current = head_;
        while (current != nullptr) {
            if (predicate(current->value)) {
                if (previous == nullptr) head_ = current->next; else previous->next = current->next;
                delete current; --size_; return true;
            }
            previous = current; current = current->next;
        }
        return false;
    }
    template <typename Visitor>
    void forEach(Visitor visitor) { for (Node* n = head_; n != nullptr; n = n->next) visitor(n->value); }
    template <typename Visitor>
    void forEach(Visitor visitor) const { for (const Node* n = head_; n != nullptr; n = n->next) visitor(n->value); }
    void clear() { while (head_ != nullptr) { Node* next = head_->next; delete head_; head_ = next; } size_ = 0; }
    [[nodiscard]] std::size_t size() const { return size_; }
    [[nodiscard]] bool empty() const { return size_ == 0; }

private:
    struct Node { T value; Node* next{nullptr}; explicit Node(const T& v, Node* n = nullptr) : value(v), next(n) {} explicit Node(T&& v, Node* n = nullptr) : value(std::move(v)), next(n) {} };
    Node* head_{nullptr};
    std::size_t size_{};
    void append(Node* node) { if (head_ == nullptr) head_ = node; else { Node* tail = head_; while (tail->next != nullptr) tail = tail->next; tail->next = node; } ++size_; }
    void swap(LinkedList& other) noexcept { std::swap(head_, other.head_); std::swap(size_, other.size_); }
};

}  // namespace emergency
