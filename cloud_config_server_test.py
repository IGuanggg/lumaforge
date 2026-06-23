import os
import tempfile
import unittest

import cloud_config_server as cloud


class CanvasCloudStorageTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.previous_db_path = cloud.DB_PATH
        cloud.DB_PATH = os.path.join(self.temp_dir.name, "cloud-test.db")
        cloud.init_db()
        with cloud.db() as conn:
            for user_id, email in ((1, "one@example.com"), (2, "two@example.com")):
                conn.execute(
                    "INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?, ?, '', '', 0)",
                    (user_id, email),
                )

    def tearDown(self):
        cloud.DB_PATH = self.previous_db_path
        self.temp_dir.cleanup()

    @staticmethod
    def payload(title, updated_at):
        return cloud.CanvasPayload(
            id="same-id",
            title=title,
            nodes=[{"id": title}],
            clientUpdatedAt=updated_at,
            createdAt="2026-06-22T00:00:00Z",
            updatedAt=updated_at,
        )

    def test_users_are_isolated_and_stale_writes_are_ignored(self):
        user_one = {"id": 1}
        user_two = {"id": 2}
        cloud.save_canvas(self.payload("new", "2026-06-22T02:00:00Z"), user_one)
        stale = cloud.save_canvas(self.payload("stale", "2026-06-22T01:00:00Z"), user_one)
        cloud.save_canvas(self.payload("other-user", "2026-06-22T03:00:00Z"), user_two)

        self.assertEqual(stale["title"], "new")
        self.assertEqual(cloud.get_canvas("same-id", user_one)["title"], "new")
        self.assertEqual(cloud.get_canvas("same-id", user_two)["title"], "other-user")

    def test_delete_is_a_visible_tombstone(self):
        user = {"id": 1}
        cloud.save_canvas(self.payload("to-delete", "2026-06-22T01:00:00Z"), user)
        deleted = cloud.delete_canvas("same-id", user)

        self.assertIsNotNone(deleted["deletedAt"])
        active = cloud.list_canvases(0, 200, False, user)
        all_items = cloud.list_canvases(0, 200, True, user)
        self.assertEqual(active["total"], 0)
        self.assertEqual(all_items["total"], 1)
        self.assertIsNotNone(all_items["items"][0]["deletedAt"])


if __name__ == "__main__":
    unittest.main()
