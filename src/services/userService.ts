import bcrypt from 'bcryptjs';
import { User, IUser } from '../models/User';
import { config } from '../config/app';
import { logger } from '../utils/logger';

export interface CreateUserData {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  role: 'admin' | 'cashier' | 'manager' | 'owner';
  phone?: string;
  store_id?: string;
}

export interface UpdateUserData {
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: 'admin' | 'cashier' | 'manager' | 'owner';
  phone?: string;
  is_active?: boolean;
  store_id?: string;
}

export interface UserResponse {
  id: string;
  email: string;
  role: string;
  first_name: string;
  last_name: string;
  phone?: string;
  is_active: boolean;
  last_login?: Date;
  created_at: Date;
  updated_at: Date;
}

export class UserService {
  /**
   * Create a new user
   */
  static async createUser(userData: CreateUserData): Promise<UserResponse> {
    try {
      // Check if user already exists
      const existingUser = await User.findOne({ email: userData.email });
      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Hash the password
      const passwordHash = await bcrypt.hash(userData.password, config.security.bcryptRounds);

      // Create new user
      const user = new User({
        ...userData,
        password_hash: passwordHash,
      });

      await user.save();

      return this.formatUserResponse(user);
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  /**
   * Get all users with pagination
   */
  static async getUsers(
    page: number = 1,
    limit: number = 20,
    search?: string,
    role?: string,
    store_id?: string
  ): Promise<{
    users: UserResponse[];
    total: number;
    page: number;
    pages: number;
  }> {
    try {
      const query: any = {};

      // Add search filter
      if (search) {
        query.$or = [
          { first_name: { $regex: search, $options: 'i' } },
          { last_name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
        ];
      }

      // Add role filter
      if (role) {
        query.role = role;
      }

      // Add store filter
      if (store_id) {
        query.store_id = store_id;
      }

      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        User.find(query)
          .select('-password_hash')
          .sort({ created_at: -1 })
          .skip(skip)
          .limit(limit),
        User.countDocuments(query),
      ]);

      return {
        users: users.map(user => this.formatUserResponse(user)),
        total,
        page,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      logger.error('Error getting users:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  static async getUserById(userId: string): Promise<UserResponse | null> {
    try {
      const user = await User.findById(userId).select('-password_hash');
      if (!user) {
        return null;
      }

      return this.formatUserResponse(user);
    } catch (error) {
      logger.error('Error getting user by ID:', error);
      throw error;
    }
  }

  /**
   * Update user
   */
  static async updateUser(userId: string, updateData: UpdateUserData): Promise<UserResponse> {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if email is being updated and if it's already taken
      if (updateData.email && updateData.email !== user.email) {
        const existingUser = await User.findOne({ email: updateData.email });
        if (existingUser) {
          throw new Error('Email already exists');
        }
      }

      // Update user
      Object.assign(user, updateData);
      await user.save();

      return this.formatUserResponse(user);
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  /**
   * Update user password
   */
  static async updateUserPassword(userId: string, newPassword: string): Promise<void> {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
      user.password_hash = passwordHash;
      await user.save();
    } catch (error) {
      logger.error('Error updating user password:', error);
      throw error;
    }
  }

  /**
   * Delete user
   */
  static async deleteUser(userId: string): Promise<void> {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await User.findByIdAndDelete(userId);
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  /**
   * Toggle user active status
   */
  static async toggleUserStatus(userId: string): Promise<UserResponse> {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      user.is_active = !user.is_active;
      await user.save();

      return this.formatUserResponse(user);
    } catch (error) {
      logger.error('Error toggling user status:', error);
      throw error;
    }
  }

  /**
   * Get users by role
   */
  static async getUsersByRole(role: string): Promise<UserResponse[]> {
    try {
      const users = await User.find({ role, is_active: true }).select('-password_hash');
      return users.map(user => this.formatUserResponse(user));
    } catch (error) {
      logger.error('Error getting users by role:', error);
      throw error;
    }
  }

  /**
   * Get users by store
   */
  static async getUsersByStore(storeId: string): Promise<UserResponse[]> {
    try {
      const users = await User.find({ store_id: storeId, is_active: true }).select('-password_hash');
      return users.map(user => this.formatUserResponse(user));
    } catch (error) {
      logger.error('Error getting users by store:', error);
      throw error;
    }
  }

  /**
   * Format user response (exclude sensitive data)
   */
  private static formatUserResponse(user: IUser): UserResponse {
    return {
      id: (user as any)._id?.toString() || '',
      email: user.email,
      role: user.role,
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      is_active: user.is_active,
      last_login: user.last_login,
      created_at: user.created_at,
      updated_at: user.updated_at,
    };
  }

  /**
   * Validate user role permissions
   */
  static validateRolePermissions(currentUserRole: string, targetUserRole: string): boolean {
    const roleHierarchy = {
      owner: 4,
      admin: 3,
      manager: 2,
      cashier: 1,
    };

    const currentLevel = roleHierarchy[currentUserRole as keyof typeof roleHierarchy] || 0;
    const targetLevel = roleHierarchy[targetUserRole as keyof typeof roleHierarchy] || 0;

    // Users can only manage users with lower or equal role level
    return currentLevel >= targetLevel;
  }

  /**
   * Check if user can perform action on another user
   */
  static canManageUser(currentUserId: string, targetUserId: string, currentUserRole: string, targetUserRole: string): boolean {
    // Users cannot manage themselves
    if (currentUserId === targetUserId) {
      return false;
    }

    // Check role permissions
    return this.validateRolePermissions(currentUserRole, targetUserRole);
  }
}
