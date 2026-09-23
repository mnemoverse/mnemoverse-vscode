# Share memory through a room

A **room** is a separate memory pool that several people and agents can read and write (Beta).

- Ask the agent to **create a room** for a project (`memory_create_room`).
- Ask it to **invite** a teammate (`memory_invite_to_room`). They join with the invite code (`memory_join_room`).
- Every room has an address such as `xroom:room_…`. Agents read and write the room by passing that address as the memory domain. A normal search does not include rooms.

`memory_list_rooms` lists the rooms you belong to and their addresses.

More in the [Mnemoverse docs](https://mnemoverse.com/docs).
